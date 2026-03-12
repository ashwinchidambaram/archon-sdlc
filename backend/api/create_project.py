import json


def lambda_handler(event, context):
    """POST /projects — Create a new project."""
    return {
        "statusCode": 201,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps({
            "project_id": "proj_placeholder",
            "name": "Placeholder Project",
            "status": "created",
            "created_at": "2024-01-01T00:00:00Z",
            "story_count": 0
        })
    }
