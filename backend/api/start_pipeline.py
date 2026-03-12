import json


def lambda_handler(event, context):
    """POST /projects/{id}/run — Start the pipeline."""
    project_id = event.get("pathParameters", {}).get("project_id", "unknown")
    return {
        "statusCode": 202,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps({
            "project_id": project_id,
            "execution_id": "exec_placeholder",
            "status": "running",
            "started_at": "2024-01-01T00:00:00Z"
        })
    }
