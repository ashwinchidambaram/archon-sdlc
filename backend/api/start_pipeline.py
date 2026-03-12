import boto3
import json
import os
from datetime import datetime

from shared.dynamodb import get_project, update_project_status
from response import success_response, error_response

sfn_client = boto3.client("stepfunctions")
SM_ARN = os.environ["STATE_MACHINE_ARN"]


def lambda_handler(event, context):
    """POST /projects/{project_id}/run — Start the SDLC pipeline."""
    project_id = event.get("pathParameters", {}).get("project_id")
    if not project_id:
        return error_response(400, "bad_request", "Missing project_id")

    project = get_project(project_id)
    if project is None:
        return error_response(404, "not_found", f"Project {project_id} not found")

    if project.get("status") == "running":
        return error_response(409, "conflict", "Pipeline already running for this project")

    sfn_input = {
        "project_id": project_id,
        "project_context": {
            "name": project.get("name", ""),
            "description": project.get("description", ""),
            "user_stories": project.get("user_stories", []),
            "tech_stack": project.get("tech_stack", ""),
        },
    }

    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    execution_name = f"{project_id}-{timestamp}"

    try:
        response = sfn_client.start_execution(
            stateMachineArn=SM_ARN,
            name=execution_name,
            input=json.dumps(sfn_input),
        )
    except Exception as e:
        return error_response(500, "sfn_error", str(e))

    exec_arn = response["executionArn"]
    started_at = datetime.utcnow().isoformat()

    update_project_status(
        project_id,
        "running",
        execution_arn=exec_arn,
        started_at=started_at,
    )

    return success_response(202, {
        "project_id": project_id,
        "execution_id": exec_arn,
        "status": "running",
        "started_at": started_at,
    })
