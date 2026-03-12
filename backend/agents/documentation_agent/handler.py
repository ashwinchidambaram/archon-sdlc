import json
import logging
from datetime import datetime, timezone

from shared.bedrock import invoke_model, parse_json_response
from shared.dynamodb import write_stage_result
from shared.s3 import read_artifact, write_files_artifact
from prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

STAGE_NAME = "documentation"


def lambda_handler(event, context):
    start_iso = datetime.now(timezone.utc).isoformat()
    project_id = event.get("project_id", "unknown")
    execution_id = event.get("execution_id", "")
    iteration = event.get("iteration", 0)
    project_context = event.get("project_context", {})
    previous_stages = event.get("previous_stages", {})

    try:
        # 1. Read requirements spec
        requirements_content = _read_stage_artifact(previous_stages, "requirements")

        # 2. Read code manifest (JSON with files array)
        codegen_content_raw = _read_stage_artifact(previous_stages, "codegen")
        codegen_files = _parse_files_manifest(codegen_content_raw, "codegen")

        # 3. Read test manifest (JSON with files array)
        testgen_content_raw = _read_stage_artifact(previous_stages, "testgen")
        testgen_files = _parse_files_manifest(testgen_content_raw, "testgen")

        # 4. Read security report (JSON)
        security_content_raw = _read_stage_artifact(previous_stages, "security")
        security_report = _parse_json_safe(security_content_raw, "security")

        # 5. Read code review (JSON)
        codereview_content_raw = _read_stage_artifact(previous_stages, "codereview")
        codereview_report = _parse_json_safe(codereview_content_raw, "codereview")

        # 6. Build user message
        user_message = _build_user_message(
            project_context,
            requirements_content,
            codegen_files,
            testgen_files,
            security_report,
            codereview_report,
        )

        # 7. Call Bedrock
        response = invoke_model(SYSTEM_PROMPT, user_message, max_tokens=8192)

        # 8. Parse JSON response
        parsed = parse_json_response(response["content"])
        files = parsed.get("files", [])
        summary = parsed.get("summary", "Documentation generation complete")

        # 9. Write doc files to S3
        s3_prefix = f"{project_id}/documentation/iter{iteration}"
        s3_key = write_files_artifact(s3_prefix, files)

        # 10. Write stage result to DynamoDB
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
            "documentation complete: %d files written, iteration %d",
            len(files),
            iteration,
        )

        # 11. Return AgentOutput
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
        logger.exception("documentation agent failed")
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


def _read_stage_artifact(previous_stages, stage_name):
    """Read the raw artifact content for a given stage. Returns empty string on any failure."""
    stage = previous_stages.get(stage_name)
    if not stage:
        logger.warning("stage %s not found in previous_stages", stage_name)
        return ""
    s3_key = stage.get("s3_key", "")
    if not s3_key:
        logger.warning("stage %s has no s3_key", stage_name)
        return ""
    try:
        return read_artifact(s3_key)
    except Exception as exc:
        logger.warning("could not read artifact for stage %s: %s", stage_name, exc)
        return ""


def _parse_files_manifest(raw_content, stage_name):
    """Parse a JSON manifest with a 'files' array. Returns list of file dicts."""
    if not raw_content:
        return []
    try:
        data = json.loads(raw_content)
        return data.get("files", [])
    except Exception:
        logger.warning("could not parse %s manifest as JSON", stage_name)
        return []


def _parse_json_safe(raw_content, stage_name):
    """Parse raw content as JSON dict. Returns dict (possibly empty) on failure."""
    if not raw_content:
        return {}
    try:
        return json.loads(raw_content)
    except Exception:
        logger.warning("could not parse %s report as JSON; using raw text", stage_name)
        return {"raw": raw_content}


def _format_files_section(files, label):
    """Format a list of file dicts into a readable section for the prompt."""
    if not files:
        return f"No {label} files available."
    parts = []
    for f in files:
        path = f.get("path", "unknown")
        content = f.get("content", "")
        parts.append(f"### {path}\n```\n{content}\n```")
    return "\n\n".join(parts)


def _build_user_message(
    project_context,
    requirements_content,
    codegen_files,
    testgen_files,
    security_report,
    codereview_report,
):
    name = project_context.get("name", "")
    description = project_context.get("description", "")
    tech_stack = project_context.get("tech_stack", "")
    user_stories = project_context.get("user_stories", [])
    stories_text = "\n".join(f"- {s}" for s in user_stories)

    code_section = _format_files_section(codegen_files, "source code")
    test_section = _format_files_section(testgen_files, "test")

    security_text = (
        json.dumps(security_report, indent=2)
        if security_report
        else "No security report available."
    )
    codereview_text = (
        json.dumps(codereview_report, indent=2)
        if codereview_report
        else "No code review available."
    )

    return f"""## Project Context

**Name:** {name}
**Description:** {description}
**Tech Stack:** {tech_stack}

**User Stories:**
{stories_text}

---

## Technical Specification

{requirements_content or "No requirements spec available."}

---

## Generated Source Code

{code_section}

---

## Generated Tests

{test_section}

---

## Security Report

```json
{security_text}
```

---

## Code Review Report

```json
{codereview_text}
```

---

Using all of the above artifacts, produce complete project documentation. Respond with a JSON object containing a `files` array (each with `path`, `description`, and `content`) and a `summary` string describing what documentation was generated."""
