import json
import uuid
from datetime import datetime

from shared.dynamodb import create_project
from response import success_response, error_response


def lambda_handler(event, context):
    """POST /projects — Create a new project."""
    body = event.get("body")
    if not body:
        return error_response(400, "bad_request", "Request body is required")

    try:
        data = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return error_response(400, "bad_request", "Invalid JSON in request body")

    # Validate required fields
    name = data.get("name")
    description = data.get("description")
    user_stories = data.get("user_stories")

    if not name or not isinstance(name, str):
        return error_response(400, "validation_error", "name is required")
    if not description or not isinstance(description, str):
        return error_response(400, "validation_error", "description is required")
    if not user_stories or not isinstance(user_stories, list) or not all(isinstance(s, str) for s in user_stories):
        return error_response(400, "validation_error", "user_stories must be a non-empty list of strings")

    tech_stack = data.get("tech_stack", "Python, FastAPI, PostgreSQL, React")
    project_id = f"proj_{uuid.uuid4().hex[:8]}"
    created_at = datetime.utcnow().isoformat()

    project = {
        "project_id": project_id,
        "name": name,
        "description": description,
        "user_stories": user_stories,
        "tech_stack": tech_stack,
        "status": "created",
        "current_iteration": 0,
        "created_at": created_at,
    }

    try:
        create_project(project)
    except Exception as e:
        print(f"DynamoDB error: {e}")
        return error_response(500, "internal_error", "Failed to create project")

    return success_response(201, {
        "project_id": project_id,
        "name": name,
        "status": "created",
        "created_at": created_at,
        "story_count": len(user_stories),
    })
