import json
import logging
from datetime import datetime, timezone

from shared.bedrock import invoke_model, parse_json_response
from shared.dynamodb import write_stage_result
from shared.s3 import read_artifact, write_files_artifact
from prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

STAGE_NAME = "testgen"
MAX_TOKENS = 16384


def lambda_handler(event, context):
    start_iso = datetime.now(timezone.utc).isoformat()
    project_id = event.get("project_id", "unknown")
    execution_id = event.get("execution_id", "")
    iteration = event.get("iteration", 0)
    project_context = event.get("project_context", {})
    previous_stages = event.get("previous_stages", {})

    try:
        # 1. Read requirements spec from S3
        req_stage = previous_stages.get("requirements", {})
        req_s3_key = req_stage.get("s3_key", "") if req_stage else ""
        spec_content = read_artifact(req_s3_key) if req_s3_key else ""

        # 2. Read generated code manifest from S3 and parse JSON to get files
        codegen_stage = previous_stages.get("codegen", {})
        codegen_s3_key = codegen_stage.get("s3_key", "") if codegen_stage else ""
        code_files = []
        if codegen_s3_key:
            try:
                manifest_content = read_artifact(codegen_s3_key)
                manifest = json.loads(manifest_content)
                code_files = manifest.get("files", [])
            except Exception:
                logger.warning("could not read codegen manifest from %s", codegen_s3_key)

        # 3. Format code files for the prompt
        code_text = format_files_for_prompt(code_files)

        # 4. Construct user message with spec + all generated code files
        user_message = build_user_message(project_context, spec_content, code_text)

        # 5. Call Bedrock — test output can be large
        response = invoke_model(SYSTEM_PROMPT, user_message, max_tokens=MAX_TOKENS, temperature=0.2)

        # 6. Parse JSON response
        parsed = parse_json_response(response["content"])
        files = parsed.get("files", [])
        summary = parsed.get("summary", "Test generation complete")
        coverage_estimate = parsed.get("coverage_estimate", {})

        # 7. Write test files to S3
        s3_prefix = f"{project_id}/testgen/iter{iteration}"
        s3_key = write_files_artifact(s3_prefix, files)

        # 8. Write stage result to DynamoDB
        end_iso = datetime.now(timezone.utc).isoformat()
        write_stage_result(project_id, STAGE_NAME, iteration, {
            "status": "completed",
            "s3_key": s3_key,
            "summary": summary,
            "started_at": start_iso,
            "completed_at": end_iso,
            "metadata": {
                "model_id": response["model_id"],
                "input_tokens": response["input_tokens"],
                "output_tokens": response["output_tokens"],
                "duration_seconds": response["duration_seconds"],
            },
        })

        logger.info(
            "testgen complete: %d test files, coverage_estimate=%s, iteration %d",
            len(files),
            coverage_estimate,
            iteration,
        )

        # 9. Return AgentOutput
        return {
            "stage": STAGE_NAME,
            "status": "completed",
            "s3_key": s3_key,
            "summary": summary,
            "iteration": iteration,
            "metadata": {
                "model_id": response["model_id"],
                "input_tokens": response["input_tokens"],
                "output_tokens": response["output_tokens"],
                "duration_seconds": response["duration_seconds"],
            },
        }

    except Exception as e:
        logger.exception("testgen agent failed")
        end_iso = datetime.now(timezone.utc).isoformat()
        try:
            write_stage_result(project_id, STAGE_NAME, iteration, {
                "status": "failed",
                "s3_key": "",
                "summary": f"Error: {e}",
                "started_at": start_iso,
                "completed_at": end_iso,
            })
        except Exception:
            logger.exception("failed to write stage result to DynamoDB")
        return {
            "stage": STAGE_NAME,
            "status": "failed",
            "s3_key": "",
            "summary": f"Error: {e}",
            "iteration": iteration,
            "metadata": {
                "model_id": "unknown",
                "input_tokens": 0,
                "output_tokens": 0,
                "duration_seconds": 0,
            },
        }


def build_user_message(project_context, spec_content, code_text):
    name = project_context.get("name", "")
    description = project_context.get("description", "")
    tech_stack = project_context.get("tech_stack", "")
    stories = project_context.get("user_stories", [])
    stories_text = "\n".join(f"- {s}" for s in stories)

    return f"""## Project Context

**Name:** {name}
**Description:** {description}
**Tech Stack:** {tech_stack}

**User Stories:**
{stories_text}

## Technical Specification

{spec_content}

## Implementation Code

{code_text}

Generate a comprehensive test suite for this implementation. Respond with a JSON object containing a `files` array, `summary`, and `coverage_estimate`."""


def format_files_for_prompt(files):
    parts = []
    for f in files:
        parts.append(f"### {f.get('path', 'unknown')}\n```\n{f.get('content', '')}\n```")
    return "\n\n".join(parts)
