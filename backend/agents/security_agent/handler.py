import json
import time


def lambda_handler(event, context):
    """Placeholder handler for Security Scan agent."""
    project_id = event.get("project_id", "unknown")
    iteration = event.get("iteration", 0)

    return {
        "stage": "security",
        "status": "completed",
        "s3_key": f"{project_id}/security/iter{iteration}/output.json",
        "summary": "Mock output from Security Scan agent (placeholder)",
        "iteration": iteration,
        "metadata": {
            "model_id": "mock",
            "input_tokens": 0,
            "output_tokens": 0,
            "duration_seconds": 0.1
        }
    }
