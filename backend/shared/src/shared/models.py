from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field
import uuid


class StageStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class StageName(str, Enum):
    REQUIREMENTS = "requirements"
    CODEGEN = "codegen"
    TESTGEN = "testgen"
    SECURITY = "security"
    CODEREVIEW = "codereview"
    DOCUMENTATION = "documentation"


class ReviewVerdict(str, Enum):
    APPROVED = "APPROVED"
    APPROVED_WITH_COMMENTS = "APPROVED_WITH_COMMENTS"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"


class ProjectStatus(str, Enum):
    CREATED = "created"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ProjectContext(BaseModel):
    name: str
    description: str
    user_stories: list[str]
    tech_stack: str = "Python, FastAPI, PostgreSQL, React"


class StageMetadata(BaseModel):
    model_id: str
    input_tokens: int
    output_tokens: int
    duration_seconds: float
    bandit_findings_count: Optional[int] = None


class StageResult(BaseModel):
    stage: StageName
    status: StageStatus
    iteration: int = 0
    s3_key: Optional[str] = None
    summary: Optional[str] = None
    verdict: Optional[ReviewVerdict] = None
    metadata: Optional[StageMetadata] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class AgentInput(BaseModel):
    project_id: str
    execution_id: str
    iteration: int = 0
    project_context: ProjectContext
    previous_stages: dict = Field(default_factory=dict)


class AgentOutput(BaseModel):
    stage: StageName
    status: StageStatus
    s3_key: str
    summary: str
    iteration: int = 0
    verdict: Optional[ReviewVerdict] = None
    metadata: StageMetadata


class Project(BaseModel):
    project_id: str = Field(default_factory=lambda: f"proj_{uuid.uuid4().hex[:8]}")
    name: str
    description: str
    user_stories: list[str]
    tech_stack: str = "Python, FastAPI, PostgreSQL, React"
    status: ProjectStatus = ProjectStatus.CREATED
    execution_arn: Optional[str] = None
    current_iteration: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class CreateProjectRequest(BaseModel):
    name: str
    description: str
    user_stories: list[str]
    tech_stack: str = "Python, FastAPI, PostgreSQL, React"
