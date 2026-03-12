import json


def lambda_handler(event, context):
    """GET /artifacts/{key} — Get artifact from S3."""
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps({
            "message": "Artifact retrieval placeholder"
        })
    }
