import json
import time


def lambda_handler(event, context):
    """Placeholder handler for Code Review agent."""
    project_id = event.get("project_id", "unknown")
    iteration = event.get("iteration", 0)

    return {
        "stage": "codereview",
        "status": "completed",
        "s3_key": f"{project_id}/codereview/iter{iteration}/output.json",
        "summary": "Mock output from Code Review agent (placeholder)",
        "iteration": iteration,
        "verdict": "APPROVED",
        "metadata": {
            "model_id": "mock",
            "input_tokens": 0,
            "output_tokens": 0,
            "duration_seconds": 0.1
        }
    }
