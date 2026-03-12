import json


def lambda_handler(event, context):
    """GET /projects/{id} — Get project details and status."""
    project_id = event.get("pathParameters", {}).get("project_id", "unknown")
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps({
            "project_id": project_id,
            "name": "Placeholder Project",
            "status": "created",
            "stages": []
        })
    }
