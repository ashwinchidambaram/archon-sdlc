import logging
from shared.bedrock import invoke_model, parse_json_response
from prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def lambda_handler(event, context):
    """Planner agent — generates user stories from a project description."""
    description = event.get("description", "")

    if not description.strip():
        return {
            "status": "error",
            "message": "No description provided",
            "user_stories": [],
            "summary": "",
        }

    try:
        response = invoke_model(SYSTEM_PROMPT, description)
        result = parse_json_response(response["content"])

        user_stories = result.get("user_stories", [])
        summary = result.get("summary", "")

        logger.info("planner generated %d user stories", len(user_stories))

        return {
            "status": "success",
            "user_stories": user_stories,
            "summary": summary,
            "metadata": {
                "model_id": response["model_id"],
                "input_tokens": response["input_tokens"],
                "output_tokens": response["output_tokens"],
                "duration_seconds": response["duration_seconds"],
            },
        }
    except Exception as e:
        logger.exception("planner agent failed")
        return {
            "status": "error",
            "message": str(e),
            "user_stories": [],
            "summary": "",
        }
