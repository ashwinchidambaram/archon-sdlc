import logging
from datetime import datetime, timezone

from shared.bedrock import invoke_model
from shared.s3 import write_artifact
from shared.dynamodb import write_stage_result
from prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

STAGE_NAME = "requirements"


def lambda_handler(event, context):
    start_iso = datetime.now(timezone.utc).isoformat()
    project_id = event.get("project_id", "unknown")
    iteration = event.get("iteration", 0)

    try:
        project_context = event.get("project_context", {})

        name = project_context.get("name", "")
        description = project_context.get("description", "")
        user_stories = project_context.get("user_stories", [])
        tech_stack = project_context.get("tech_stack", "")

        stories_text = "\n".join(
            f"- {story}" for story in user_stories
        )

        user_message = f"""Project Name: {name}

Project Description:
{description}

Tech Stack:
{tech_stack}

User Stories:
{stories_text}

Produce a complete technical specification document following the required output structure."""

        response = invoke_model(SYSTEM_PROMPT, user_message)

        end_iso = datetime.now(timezone.utc).isoformat()

        spec_content = response["content"]

        s3_key = f"{project_id}/requirements/technical-spec.md"
        write_artifact(s3_key, spec_content, content_type="text/markdown")

        section_count = spec_content.count("\n### ")
        summary = f"Generated technical specification with {section_count} sections"

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
            }
        })

        logger.info("requirements complete: %s", summary)

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
            }
        }

    except Exception as e:
        logger.exception("requirements agent failed")
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
