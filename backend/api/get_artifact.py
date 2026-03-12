"""GET /artifacts/{proxy+} — Retrieve artifacts from S3."""

from botocore.exceptions import ClientError
from shared.s3 import read_artifact
from response import error_response, raw_response


def get_content_type(s3_key: str) -> str:
    """Determine content type based on file extension."""
    if s3_key.endswith(".md"):
        return "text/markdown"
    elif s3_key.endswith(".json"):
        return "application/json"
    elif s3_key.endswith(".py"):
        return "text/x-python"
    elif s3_key.endswith(".txt"):
        return "text/plain"
    else:
        return "text/plain"


def lambda_handler(event, context):
    """GET /artifacts/{proxy+} — Get artifact from S3."""
    try:
        # Extract S3 key from path parameters
        s3_key = event["pathParameters"]["proxy"]

        # Read artifact from S3
        content = read_artifact(s3_key)

        # Determine content type from extension
        content_type = get_content_type(s3_key)

        # Return raw response with appropriate content type
        return raw_response(200, content, content_type)

    except ClientError as e:
        # Check if key doesn't exist
        if e.response["Error"]["Code"] == "NoSuchKey":
            return error_response(404, "NotFound", f"Artifact not found: {s3_key}")
        # Other S3 errors
        return error_response(500, "InternalError", "Failed to retrieve artifact")

    except Exception as e:
        # Unexpected errors
        return error_response(500, "InternalError", str(e))
