import json
import time
from datetime import datetime, timezone

from shared.bedrock import invoke_model
from shared.s3 import write_artifact
from shared.dynamodb import write_stage_result
from prompt import SYSTEM_PROMPT


def lambda_handler(event, context):
    start_iso = datetime.now(timezone.utc).isoformat()

    try:
        project_id = event["project_id"]
        execution_id = event["execution_id"]
        iteration = event.get("iteration", 0)
        project_context = event["project_context"]

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

        write_stage_result(project_id, "requirements", iteration, {
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

        return {
            "stage": "requirements",
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
        return {
            "stage": "requirements",
            "status": "failed",
            "summary": str(e),
            "iteration": event.get("iteration", 0),
            "metadata": {}
        }
