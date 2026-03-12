"""Bedrock client wrapper for invoking Claude models."""

import json
import logging
import os
import time
from typing import Optional

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

# Defaults
DEFAULT_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"
DEFAULT_REGION = "us-east-1"
DEFAULT_MAX_TOKENS = 8192
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2


def get_bedrock_client():
    """Create a Bedrock Runtime client."""
    region = os.environ.get("BEDROCK_REGION", DEFAULT_REGION)
    return boto3.client("bedrock-runtime", region_name=region)


def invoke_model(
    system_prompt: str,
    user_message: str,
    model_id: Optional[str] = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    temperature: float = 0.2,
) -> dict:
    """Invoke a Claude model via Bedrock with retry logic.

    Returns a dict with:
        - content: str (the model's response text)
        - input_tokens: int
        - output_tokens: int
        - model_id: str
        - duration_seconds: float
    """
    model_id = model_id or os.environ.get("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID)
    client = get_bedrock_client()

    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "temperature": temperature,
        "system": system_prompt,
        "messages": [
            {
                "role": "user",
                "content": user_message,
            }
        ],
    }

    last_error = None
    for attempt in range(MAX_RETRIES):
        start_time = time.time()
        try:
            response = client.invoke_model(
                modelId=model_id,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(request_body),
            )

            duration = time.time() - start_time
            response_body = json.loads(response["body"].read())

            content = ""
            for block in response_body.get("content", []):
                if block.get("type") == "text":
                    content += block["text"]

            usage = response_body.get("usage", {})

            result = {
                "content": content,
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
                "model_id": model_id,
                "duration_seconds": round(duration, 2),
            }

            logger.info(
                "Bedrock call succeeded: model=%s, input_tokens=%d, output_tokens=%d, duration=%.2fs",
                model_id,
                result["input_tokens"],
                result["output_tokens"],
                result["duration_seconds"],
            )

            return result

        except ClientError as e:
            last_error = e
            error_code = e.response["Error"]["Code"]

            # Retry on throttling and transient errors
            if error_code in (
                "ThrottlingException",
                "ServiceUnavailableException",
                "ModelTimeoutException",
            ):
                wait_time = RETRY_BACKOFF_BASE ** attempt
                logger.warning(
                    "Bedrock call failed (attempt %d/%d): %s — retrying in %ds",
                    attempt + 1,
                    MAX_RETRIES,
                    error_code,
                    wait_time,
                )
                time.sleep(wait_time)
                continue

            # Non-retryable error
            logger.error("Bedrock call failed (non-retryable): %s — %s", error_code, str(e))
            raise

    # All retries exhausted
    logger.error("Bedrock call failed after %d attempts", MAX_RETRIES)
    raise last_error  # type: ignore[misc]


def parse_json_response(content: str) -> dict:
    """Parse a JSON response from the model, handling markdown code fences."""
    text = content.strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        # Remove opening fence (```json or ```)
        first_newline = text.index("\n")
        text = text[first_newline + 1 :]
        # Remove closing fence
        if text.endswith("```"):
            text = text[: -3].strip()

    return json.loads(text)
