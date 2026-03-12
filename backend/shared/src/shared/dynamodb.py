import boto3
import logging
import os
from datetime import datetime

from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)


def get_table():
    table_name = os.environ["PROJECTS_TABLE"]
    dynamodb = boto3.resource("dynamodb")
    return dynamodb.Table(table_name)


def create_project(project: dict) -> dict:
    table = get_table()
    project_id = project["project_id"]
    item = {
        "pk": f"PROJECT#{project_id}",
        "sk": "METADATA",
        **project,
    }
    table.put_item(Item=item)
    logger.info("created project %s", project_id)
    return project


def get_project(project_id: str) -> dict | None:
    table = get_table()
    response = table.get_item(
        Key={
            "pk": f"PROJECT#{project_id}",
            "sk": "METADATA",
        }
    )
    item = response.get("Item")
    if item is None:
        logger.debug("project %s not found", project_id)
        return None
    item.pop("pk", None)
    item.pop("sk", None)
    return item


def update_project_status(project_id: str, status: str, **kwargs) -> None:
    table = get_table()
    fields = {"status": status, **kwargs}
    set_parts = []
    expr_names = {}
    expr_values = {}
    for i, (key, value) in enumerate(fields.items()):
        name_token = f"#f{i}"
        value_token = f":v{i}"
        set_parts.append(f"{name_token} = {value_token}")
        expr_names[name_token] = key
        expr_values[value_token] = value
    update_expression = "SET " + ", ".join(set_parts)
    table.update_item(
        Key={
            "pk": f"PROJECT#{project_id}",
            "sk": "METADATA",
        },
        UpdateExpression=update_expression,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
    logger.info("updated project %s status -> %s", project_id, status)


def write_stage_result(
    project_id: str,
    stage: str,
    iteration: int,
    result: dict,
) -> None:
    table = get_table()
    sk = f"STAGE#{stage}#iter{iteration}"
    item = {
        "pk": f"PROJECT#{project_id}",
        "sk": sk,
        "status": result.get("status"),
        "s3_key": result.get("s3_key"),
        "summary": result.get("summary"),
        "metadata": result.get("metadata"),
        "started_at": result.get("started_at"),
        "completed_at": result.get("completed_at"),
    }
    if "verdict" in result:
        item["verdict"] = result["verdict"]
    # drop None values to keep items clean
    item = {k: v for k, v in item.items() if v is not None}
    table.put_item(Item=item)
    logger.info("wrote stage result %s/%s iter%d", project_id, stage, iteration)


def get_stage_result(project_id: str, stage: str, iteration: int) -> dict | None:
    table = get_table()
    sk = f"STAGE#{stage}#iter{iteration}"
    response = table.get_item(
        Key={
            "pk": f"PROJECT#{project_id}",
            "sk": sk,
        }
    )
    item = response.get("Item")
    if item is None:
        logger.debug("stage result %s/%s iter%d not found", project_id, stage, iteration)
        return None
    item.pop("pk", None)
    item.pop("sk", None)
    return item


def get_all_stages(project_id: str) -> list[dict]:
    table = get_table()
    response = table.query(
        KeyConditionExpression=(
            Key("pk").eq(f"PROJECT#{project_id}") & Key("sk").begins_with("STAGE#")
        )
    )
    items = response.get("Items", [])
    items.sort(key=lambda x: x.get("sk", ""))
    for item in items:
        item.pop("pk", None)
        item.pop("sk", None)
    return items


def get_stage_iterations(project_id: str, stage: str) -> list[dict]:
    table = get_table()
    prefix = f"STAGE#{stage}#"
    response = table.query(
        KeyConditionExpression=(
            Key("pk").eq(f"PROJECT#{project_id}") & Key("sk").begins_with(prefix)
        )
    )
    items = response.get("Items", [])
    items.sort(key=lambda x: x.get("sk", ""))
    for item in items:
        item.pop("pk", None)
        item.pop("sk", None)
    return items
