"""Unit tests for shared Pydantic models."""

from datetime import datetime
from shared.models import (
    AgentInput,
    AgentOutput,
    CreateProjectRequest,
    Project,
    ProjectContext,
    ProjectStatus,
    ReviewVerdict,
    StageMetadata,
    StageName,
    StageResult,
    StageStatus,
)


def test_project_generates_id():
    p = Project(name="test", description="desc", user_stories=["story1"])
    assert p.project_id.startswith("proj_")
    assert len(p.project_id) == 13  # "proj_" + 8 hex chars


def test_project_defaults():
    p = Project(name="test", description="desc", user_stories=["story1"])
    assert p.status == ProjectStatus.CREATED
    assert p.tech_stack == "Python, FastAPI, PostgreSQL, React"
    assert p.current_iteration == 0
    assert p.execution_arn is None
    assert isinstance(p.created_at, datetime)


def test_project_context():
    ctx = ProjectContext(
        name="Test Project",
        description="A test project",
        user_stories=["As a user, I want to log in"],
    )
    assert ctx.name == "Test Project"
    assert len(ctx.user_stories) == 1
    assert ctx.tech_stack == "Python, FastAPI, PostgreSQL, React"


def test_agent_input():
    inp = AgentInput(
        project_id="proj_abc12345",
        execution_id="exec-123",
        iteration=0,
        project_context=ProjectContext(
            name="Test",
            description="Desc",
            user_stories=["story"],
        ),
    )
    assert inp.iteration == 0
    assert inp.previous_stages == {}


def test_agent_output():
    out = AgentOutput(
        stage=StageName.REQUIREMENTS,
        status=StageStatus.COMPLETED,
        s3_key="proj_abc/requirements/technical-spec.md",
        summary="Generated technical spec",
        iteration=0,
        metadata=StageMetadata(
            model_id="anthropic.claude-3-5-sonnet",
            input_tokens=1000,
            output_tokens=2000,
            duration_seconds=5.3,
        ),
    )
    assert out.stage == StageName.REQUIREMENTS
    assert out.verdict is None
    assert out.metadata.input_tokens == 1000


def test_agent_output_with_verdict():
    out = AgentOutput(
        stage=StageName.CODEREVIEW,
        status=StageStatus.COMPLETED,
        s3_key="proj_abc/codereview/iter0/review.json",
        summary="Code review complete",
        iteration=0,
        verdict=ReviewVerdict.CHANGES_REQUESTED,
        metadata=StageMetadata(
            model_id="anthropic.claude-3-5-sonnet",
            input_tokens=3000,
            output_tokens=1500,
            duration_seconds=8.1,
        ),
    )
    assert out.verdict == ReviewVerdict.CHANGES_REQUESTED


def test_stage_result():
    r = StageResult(
        stage=StageName.CODEGEN,
        status=StageStatus.COMPLETED,
        iteration=1,
        s3_key="proj_abc/codegen/iter1/manifest.json",
        summary="Revised code",
    )
    assert r.iteration == 1
    assert r.verdict is None


def test_create_project_request():
    req = CreateProjectRequest(
        name="My Project",
        description="A project",
        user_stories=["Story 1", "Story 2"],
    )
    assert len(req.user_stories) == 2
    assert req.tech_stack == "Python, FastAPI, PostgreSQL, React"


def test_review_verdict_values():
    assert ReviewVerdict.APPROVED == "APPROVED"
    assert ReviewVerdict.APPROVED_WITH_COMMENTS == "APPROVED_WITH_COMMENTS"
    assert ReviewVerdict.CHANGES_REQUESTED == "CHANGES_REQUESTED"


def test_stage_name_values():
    assert StageName.REQUIREMENTS == "requirements"
    assert StageName.CODEGEN == "codegen"
    assert StageName.TESTGEN == "testgen"
    assert StageName.SECURITY == "security"
    assert StageName.CODEREVIEW == "codereview"
    assert StageName.DOCUMENTATION == "documentation"


def test_project_serialization():
    p = Project(name="test", description="desc", user_stories=["s1"])
    data = p.model_dump()
    assert "project_id" in data
    assert "status" in data
    assert data["status"] == "created"


def test_agent_output_serialization():
    out = AgentOutput(
        stage=StageName.REQUIREMENTS,
        status=StageStatus.COMPLETED,
        s3_key="test/key",
        summary="test",
        metadata=StageMetadata(
            model_id="test",
            input_tokens=100,
            output_tokens=200,
            duration_seconds=1.0,
        ),
    )
    data = out.model_dump()
    assert data["stage"] == "requirements"
    assert data["status"] == "completed"
    assert data["verdict"] is None
