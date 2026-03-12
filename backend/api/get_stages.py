import json


def lambda_handler(event, context):
    """GET /projects/{id}/stages — Get all stage results."""
    project_id = event.get("pathParameters", {}).get("project_id", "unknown")
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps({
            "project_id": project_id,
            "stages": []
        })
    }
