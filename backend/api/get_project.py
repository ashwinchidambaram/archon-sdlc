import boto3
import os

from shared.dynamodb import get_project, get_all_stages, update_project_status
from response import success_response, error_response

sfn_client = boto3.client("stepfunctions")


def lambda_handler(event, context):
    """GET /projects/{project_id} — Get project details and pipeline stage status."""
    project_id = event.get("pathParameters", {}).get("project_id")
    if not project_id:
        return error_response(400, "bad_request", "Missing project_id path parameter")

    project = get_project(project_id)
    if project is None:
        return error_response(404, "not_found", f"Project {project_id} not found")

    stages = get_all_stages(project_id)
    project["stages"] = stages

    if project.get("status") == "running":
        execution_arn = project.get("execution_arn")
        if execution_arn:
            try:
                resp = sfn_client.describe_execution(executionArn=execution_arn)
                sfn_status = resp.get("status")
                completed_at = resp.get("stopDate")
                completed_at_str = completed_at.isoformat() if completed_at else None

                if sfn_status == "SUCCEEDED":
                    update_project_status(
                        project_id,
                        "completed",
                        **({"completed_at": completed_at_str} if completed_at_str else {}),
                    )
                    project["status"] = "completed"
                    if completed_at_str:
                        project["completed_at"] = completed_at_str

                elif sfn_status in ("FAILED", "TIMED_OUT", "ABORTED"):
                    update_project_status(
                        project_id,
                        "failed",
                        **({"completed_at": completed_at_str} if completed_at_str else {}),
                    )
                    project["status"] = "failed"
                    if completed_at_str:
                        project["completed_at"] = completed_at_str

            except Exception as e:
                # SFN sync is best-effort; return project data without status update
                print(f"SFN sync error: {e}")

    return success_response(200, project)
