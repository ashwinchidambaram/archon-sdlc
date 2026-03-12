import ast
import json
import logging
import time
from datetime import datetime, timezone

from shared.bedrock import invoke_model, parse_json_response
from shared.dynamodb import write_stage_result
from shared.s3 import read_artifact, write_artifact, write_files_artifact, write_json_artifact
from prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

STAGE_NAME = "codegen"
MAX_TOKENS = 16384


def lambda_handler(event, context):
    start_iso = datetime.now(timezone.utc).isoformat()
    project_id = event.get("project_id", "unknown")
    execution_id = event.get("execution_id", "")
    iteration = event.get("iteration", 0)
    project_context = event.get("project_context", {})
    previous_stages = event.get("previous_stages", {})

    try:
        # 1. Read requirements spec (always needed)
        req_stage = previous_stages.get("requirements", {})
        req_s3_key = req_stage.get("s3_key", "") if req_stage else ""
        spec_content = read_artifact(req_s3_key) if req_s3_key else ""

        # 2. Build user message based on iteration
        if iteration == 0 or not previous_stages.get("codereview"):
            user_message = build_initial_message(project_context, spec_content)
        else:
            user_message = build_revision_message(
                project_context, spec_content, previous_stages
            )

        # 3. Call Bedrock with higher token limit for code output
        response = invoke_model(
            SYSTEM_PROMPT, user_message, max_tokens=MAX_TOKENS, temperature=0.2
        )

        # 4. Parse JSON response
        parsed = parse_json_response(response["content"])
        files = parsed.get("files", [])
        summary = parsed.get("summary", "Code generation complete")
        revision_notes = parsed.get("revision_notes")

        # 5. Level 1 validation — ast.parse every Python file
        validation_results = validate_python_files(files)
        invalid_files = [r for r in validation_results if not r["valid"]]

        # 6. Build manifest
        manifest = {
            "files": files,
            "summary": summary,
            "revision_notes": revision_notes if iteration > 0 else None,
            "validation": {
                "total_python_files": len(validation_results),
                "valid": len(validation_results) - len(invalid_files),
                "invalid": len(invalid_files),
                "errors": invalid_files,
            },
        }

        # 7. Write files + manifest to S3
        s3_prefix = f"{project_id}/codegen/iter{iteration}"
        s3_key = write_files_artifact(s3_prefix, files)

        # Also write the full manifest with validation results
        manifest_key = f"{s3_prefix}/manifest.json"
        write_json_artifact(manifest_key, manifest)

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

        if invalid_files:
            logger.warning(
                "validation: %d/%d Python files have syntax errors",
                len(invalid_files),
                len(validation_results),
            )

        logger.info(
            "codegen complete: %d files, %d valid python files, iteration %d",
            len(files),
            len(validation_results) - len(invalid_files),
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
        logger.exception("codegen agent failed")
        end_iso = datetime.now(timezone.utc).isoformat()
        write_stage_result(project_id, STAGE_NAME, iteration, {
            "status": "failed",
            "s3_key": "",
            "summary": f"Error: {e}",
            "started_at": start_iso,
            "completed_at": end_iso,
        })
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


def build_initial_message(project_context, spec_content):
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

Generate the complete implementation. Respond with a JSON object containing a `files` array, `summary`, and `revision_notes` (null for initial generation)."""


def build_revision_message(project_context, spec_content, previous_stages):
    name = project_context.get("name", "")
    tech_stack = project_context.get("tech_stack", "")

    # Read previous code manifest
    codegen_stage = previous_stages.get("codegen", {})
    codegen_s3_key = codegen_stage.get("s3_key", "") if codegen_stage else ""
    previous_manifest = {}
    if codegen_s3_key:
        try:
            previous_manifest = json.loads(read_artifact(codegen_s3_key))
        except Exception:
            logger.warning("could not read previous codegen manifest")

    previous_files = previous_manifest.get("files", [])
    prev_code_text = format_files_for_prompt(previous_files)

    # Read review feedback
    review_stage = previous_stages.get("codereview", {})
    review_s3_key = review_stage.get("s3_key", "") if review_stage else ""
    review_content = ""
    if review_s3_key:
        try:
            review_content = read_artifact(review_s3_key)
        except Exception:
            logger.warning("could not read code review feedback")

    return f"""## Project Context

**Name:** {name}
**Tech Stack:** {tech_stack}

## Technical Specification

{spec_content}

## Previous Code (to be revised)

{prev_code_text}

## Code Review Feedback — Fix ALL issues marked P1 and P2

{review_content}

Generate the revised implementation addressing all review feedback. Respond with a JSON object containing a `files` array, `summary`, and `revision_notes` describing what changed."""


def format_files_for_prompt(files):
    parts = []
    for f in files:
        parts.append(f"### {f.get('path', 'unknown')}\n```\n{f.get('content', '')}\n```")
    return "\n\n".join(parts)


def validate_python_files(files):
    results = []
    for f in files:
        path = f.get("path", "")
        if not path.endswith(".py"):
            continue
        content = f.get("content", "")
        try:
            ast.parse(content)
            results.append({"file": path, "valid": True})
        except SyntaxError as e:
            results.append({
                "file": path,
                "valid": False,
                "error": f"Line {e.lineno}: {e.msg}",
            })
    return results
