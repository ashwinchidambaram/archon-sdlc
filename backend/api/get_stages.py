"""GET /projects/{project_id}/stages — Get all stage results for a project."""

from shared.dynamodb import get_all_stages
from response import success_response, error_response


def lambda_handler(event, context):
    """Fetch all stages for a project."""
    try:
        # Extract project_id from path parameters
        project_id = event["pathParameters"]["project_id"]

        # Get all stages for this project
        stages = get_all_stages(project_id)

        # Return success response
        return success_response(200, {
            "project_id": project_id,
            "stages": stages
        })

    except KeyError as e:
        return error_response(400, "BadRequest", f"Missing parameter: {str(e)}")
    except Exception as e:
        return error_response(500, "InternalServerError", str(e))
