"""Bedrock client wrapper using the model-agnostic Converse API."""

import json
import logging
import os
import re
import time
from typing import Optional

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

# Defaults
DEFAULT_MODEL_ID = "us.amazon.nova-pro-v1:0"
DEFAULT_REGION = "us-east-1"
DEFAULT_MAX_TOKENS = 8192
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2


def get_bedrock_client():
    """Create a Bedrock Runtime client with extended timeouts for large models."""
    region = os.environ.get("BEDROCK_REGION", DEFAULT_REGION)
    config = Config(read_timeout=600, connect_timeout=10)
    return boto3.client("bedrock-runtime", region_name=region, config=config)


def invoke_model(
    system_prompt: str,
    user_message: str,
    model_id: Optional[str] = None,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    temperature: float = 0.2,
) -> dict:
    """Invoke a model via Bedrock Converse API with retry logic.

    Uses the model-agnostic Converse API which works with all Bedrock models
    (Anthropic Claude, Amazon Nova, Meta Llama, etc.).

    Returns a dict with:
        - content: str (the model's response text)
        - input_tokens: int
        - output_tokens: int
        - model_id: str
        - duration_seconds: float
    """
    model_id = model_id or os.environ.get("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID)
    client = get_bedrock_client()

    last_error = None
    for attempt in range(MAX_RETRIES):
        start_time = time.time()
        try:
            response = client.converse(
                modelId=model_id,
                system=[{"text": system_prompt}],
                messages=[
                    {
                        "role": "user",
                        "content": [{"text": user_message}],
                    }
                ],
                inferenceConfig={
                    "maxTokens": max_tokens,
                    "temperature": temperature,
                },
            )

            duration = time.time() - start_time

            # Extract text from response
            content = ""
            for block in response.get("output", {}).get("message", {}).get("content", []):
                if "text" in block:
                    content += block["text"]

            usage = response.get("usage", {})

            result = {
                "content": content,
                "input_tokens": usage.get("inputTokens", 0),
                "output_tokens": usage.get("outputTokens", 0),
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
    """Parse a JSON response from the model, handling markdown code fences,
    trailing text, and control characters that non-Claude models may produce."""
    text = content.strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        # Remove opening fence (```json or ```)
        newline_pos = text.find("\n")
        if newline_pos == -1:
            text = text.lstrip("`").lstrip("json").strip()
        else:
            text = text[newline_pos + 1 :]
        # Remove closing fence
        if text.endswith("```"):
            text = text[: -3].strip()

    # Remove control characters (except \n, \r, \t) that some models inject
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', text)

    # Try parsing directly first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # If that fails, find the first { and last matching } to extract JSON object
    first_brace = text.find("{")
    if first_brace == -1:
        raise json.JSONDecodeError("No JSON object found", text, 0)

    # Walk backwards to find the matching closing brace
    last_brace = text.rfind("}")
    if last_brace == -1:
        raise json.JSONDecodeError("No closing brace found", text, len(text))

    candidate = text[first_brace : last_brace + 1]
    return json.loads(candidate)
