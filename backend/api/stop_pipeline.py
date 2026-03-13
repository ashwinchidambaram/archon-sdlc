import boto3
import json
import os
from datetime import datetime

from shared.dynamodb import get_project, update_project_status
from response import success_response, error_response

sfn_client = boto3.client("stepfunctions")


def lambda_handler(event, context):
    """POST /projects/{project_id}/stop — Stop a running pipeline."""
    project_id = event.get("pathParameters", {}).get("project_id")
    if not project_id:
        return error_response(400, "bad_request", "Missing project_id")

    project = get_project(project_id)
    if project is None:
        return error_response(404, "not_found", f"Project {project_id} not found")

    if project.get("status") != "running":
        return error_response(409, "conflict", "Pipeline is not currently running")

    execution_arn = project.get("execution_arn")
    if not execution_arn:
        return error_response(500, "internal_error", "No execution ARN found for this project")

    try:
        sfn_client.stop_execution(
            executionArn=execution_arn,
            cause="Stopped by user",
        )
    except Exception as e:
        return error_response(500, "sfn_error", str(e))

    update_project_status(
        project_id,
        "failed",
        completed_at=datetime.utcnow().isoformat(),
    )

    return success_response(200, {
        "project_id": project_id,
        "status": "failed",
        "message": "Pipeline execution stopped",
    })
