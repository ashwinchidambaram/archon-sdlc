"""Shared response helpers for API Lambda handlers."""

import json
from decimal import Decimal


class ApiEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal, datetime, and other types from DynamoDB."""

    def default(self, obj):
        if isinstance(obj, Decimal):
            if obj % 1 == 0:
                return int(obj)
            return float(obj)
        return str(obj)


CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
}


def success_response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, cls=ApiEncoder),
    }


def error_response(status_code: int, error: str, message: str) -> dict:
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": error, "message": message}),
    }


def raw_response(status_code: int, body: str, content_type: str = "text/plain") -> dict:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": content_type,
            "Access-Control-Allow-Origin": "*",
        },
        "body": body,
    }
