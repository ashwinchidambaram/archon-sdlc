import json
import logging
import os

import boto3

from response import success_response, error_response

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

lambda_client = boto3.client("lambda")


def lambda_handler(event, context):
    """POST /plan — Generate user stories from a project description."""
    try:
        body = json.loads(event.get("body", "{}"))
    except (json.JSONDecodeError, TypeError):
        return error_response(400, "bad_request", "Invalid JSON body")

    description = body.get("description", "").strip()
    if not description:
        return error_response(400, "bad_request", "Missing 'description' field")

    if len(description) > 10000:
        return error_response(400, "bad_request", "Description exceeds 10,000 character limit")

    planner_fn = os.environ.get("PLANNER_FUNCTION_NAME")
    if not planner_fn:
        return error_response(500, "config_error", "Planner function not configured")

    try:
        resp = lambda_client.invoke(
            FunctionName=planner_fn,
            InvocationType="RequestResponse",
            Payload=json.dumps({"description": description}),
        )

        payload = json.loads(resp["Payload"].read())

        if payload.get("status") == "error":
            return error_response(500, "planner_error", payload.get("message", "Planner failed"))

        return success_response(200, {
            "user_stories": payload.get("user_stories", []),
            "summary": payload.get("summary", ""),
        })

    except Exception as e:
        logger.exception("plan endpoint failed for: %s", description[:100])
        return error_response(500, "internal_error", str(e))
