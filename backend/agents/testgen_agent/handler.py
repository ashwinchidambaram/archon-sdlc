import json
import time


def lambda_handler(event, context):
    """Placeholder handler for Test Generation agent."""
    project_id = event.get("project_id", "unknown")
    iteration = event.get("iteration", 0)

    return {
        "stage": "testgen",
        "status": "completed",
        "s3_key": f"{project_id}/testgen/iter{iteration}/output.json",
        "summary": "Mock output from Test Generation agent (placeholder)",
        "iteration": iteration,
        "metadata": {
            "model_id": "mock",
            "input_tokens": 0,
            "output_tokens": 0,
            "duration_seconds": 0.1
        }
    }
