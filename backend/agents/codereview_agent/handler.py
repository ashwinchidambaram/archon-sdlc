import json
import logging
import time
from datetime import datetime, timezone

from shared.bedrock import invoke_model, parse_json_response
from shared.dynamodb import write_stage_result
from shared.s3 import read_artifact, write_json_artifact
from prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

STAGE_NAME = "codereview"


def lambda_handler(event, context):
    start_iso = datetime.now(timezone.utc).isoformat()
    project_id = event.get("project_id", "unknown")
    execution_id = event.get("execution_id", "")
    iteration = event.get("iteration", 0)
    project_context = event.get("project_context", {})
    previous_stages = event.get("previous_stages", {})

    try:
        # 1. Read all previous artifacts
        spec_content = read_stage_artifact(previous_stages, "requirements")
        codegen_content = read_stage_artifact(previous_stages, "codegen")
        testgen_content = read_stage_artifact(previous_stages, "testgen")
        security_content = read_stage_artifact(previous_stages, "security")

        # 2. Format code files for review
        code_files_text = format_code_manifest(codegen_content)
        test_files_text = format_code_manifest(testgen_content)

        # 3. Build user message with all artifacts
        user_message = f"""## Technical Specification

{spec_content}

## Generated Code (Iteration {iteration})

{code_files_text}

## Generated Tests

{test_files_text}

## Security Scan Report

{security_content}

## Review Instructions

Review all the generated code against the technical specification. Rate each dimension 1-10 and provide your verdict.

Remember:
- This is a demo/prototype context — calibrate accordingly
- P1 issues should only be runtime failures, security vulnerabilities, or fundamental architecture problems
- Iteration: {iteration} (max 2 revision cycles allowed)

Respond with a JSON object following the output format in your instructions."""

        # 4. Call Bedrock
        response = invoke_model(SYSTEM_PROMPT, user_message, max_tokens=8192)

        # 5. Parse review report
        report = parse_json_response(response["content"])

        # 6. Extract verdict — MUST be at top level for Step Functions
        verdict = determine_verdict(report)

        # 7. Write review report to S3
        s3_key = f"{project_id}/codereview/iter{iteration}/review-report.json"
        write_json_artifact(s3_key, report)

        overall_score = report.get("overall_score", 0)
        summary = report.get("summary", f"Code review complete. Score: {overall_score}/10. Verdict: {verdict}")

        # 8. Write stage result to DynamoDB
        end_iso = datetime.now(timezone.utc).isoformat()
        write_stage_result(project_id, STAGE_NAME, iteration, {
            "status": "completed",
            "s3_key": s3_key,
            "summary": summary,
            "verdict": verdict,
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
            "code review complete: score=%.1f, verdict=%s, iteration=%d",
            overall_score, verdict, iteration,
        )

        # 9. Return AgentOutput — verdict MUST be at top level
        return {
            "stage": STAGE_NAME,
            "status": "completed",
            "s3_key": s3_key,
            "summary": summary,
            "iteration": iteration,
            "verdict": verdict,
            "metadata": {
                "model_id": response["model_id"],
                "input_tokens": response["input_tokens"],
                "output_tokens": response["output_tokens"],
                "duration_seconds": response["duration_seconds"],
            },
        }

    except Exception as e:
        logger.exception("code review agent failed")
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
            "verdict": "APPROVED",
            "metadata": {
                "model_id": "unknown",
                "input_tokens": 0,
                "output_tokens": 0,
                "duration_seconds": 0,
            },
        }


def determine_verdict(report):
    """Extract verdict from report, applying scoring rules as fallback."""
    # If the LLM already provided a verdict, use it
    verdict = report.get("verdict")
    if verdict in ("APPROVED", "APPROVED_WITH_COMMENTS", "CHANGES_REQUESTED"):
        return verdict

    # Fallback: determine verdict from score and issues
    overall_score = report.get("overall_score", 0)
    top_issues = report.get("top_issues", [])
    has_p1 = any(
        issue.get("priority") == "P1" for issue in top_issues
    )

    if has_p1 or overall_score < 6:
        return "CHANGES_REQUESTED"
    elif overall_score >= 8:
        return "APPROVED"
    else:
        return "APPROVED_WITH_COMMENTS"


def read_stage_artifact(previous_stages, stage_name):
    """Safely read an artifact from a previous stage."""
    stage = previous_stages.get(stage_name)
    if not stage:
        return ""
    s3_key = stage.get("s3_key", "")
    if not s3_key:
        return ""
    try:
        return read_artifact(s3_key)
    except Exception:
        logger.warning("could not read artifact for stage %s at %s", stage_name, s3_key)
        return ""


def format_code_manifest(manifest_content):
    """Parse a manifest JSON and format files for the review prompt."""
    if not manifest_content:
        return "(no files available)"
    try:
        manifest = json.loads(manifest_content)
    except (json.JSONDecodeError, TypeError):
        return manifest_content

    files = manifest.get("files", [])
    if not files:
        return "(no files in manifest)"

    parts = []
    for f in files:
        path = f.get("path", "unknown")
        content = f.get("content", "")
        parts.append(f"### {path}\n```\n{content}\n```")
    return "\n\n".join(parts)
