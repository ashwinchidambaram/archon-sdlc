from boto3.dynamodb.conditions import Attr

from shared.dynamodb import get_table
from response import success_response, error_response


def lambda_handler(event, context):
    """GET /projects — List all projects, sorted by created_at descending."""
    try:
        table = get_table()
        response = table.scan(
            FilterExpression=Attr("sk").eq("METADATA"),
        )
        items = response.get("Items", [])

        # handle DynamoDB pagination
        while "LastEvaluatedKey" in response:
            response = table.scan(
                FilterExpression=Attr("sk").eq("METADATA"),
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
            items.extend(response.get("Items", []))

        for item in items:
            item.pop("pk", None)
            item.pop("sk", None)

        items.sort(key=lambda x: x.get("created_at", ""), reverse=True)

        return success_response(200, {"projects": items})

    except Exception as e:
        return error_response(500, "internal_error", str(e))
