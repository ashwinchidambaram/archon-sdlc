// Enums mirroring Python Pydantic models

export enum StageStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum StageName {
  REQUIREMENTS = "requirements",
  CODEGEN = "codegen",
  TESTGEN = "testgen",
  SECURITY = "security",
  CODEREVIEW = "codereview",
  DOCUMENTATION = "documentation",
}

export enum ReviewVerdict {
  APPROVED = "APPROVED",
  APPROVED_WITH_COMMENTS = "APPROVED_WITH_COMMENTS",
  CHANGES_REQUESTED = "CHANGES_REQUESTED",
}

export enum ProjectStatus {
  CREATED = "created",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
}

// Data models

export interface StageMetadata {
  model_id: string;
  input_tokens: number;
  output_tokens: number;
  duration_seconds: number;
  bandit_findings_count?: number;
}

export interface StageResult {
  stage: StageName;
  status: StageStatus;
  iteration?: number;
  s3_key?: string | null;
  summary?: string | null;
  verdict?: ReviewVerdict | null;
  metadata?: StageMetadata | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface Project {
  project_id: string;
  name: string;
  description: string;
  user_stories: string[];
  tech_stack: string;
  status: ProjectStatus;
  execution_arn?: string | null;
  current_iteration?: number;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  stages?: StageResult[];
}

// API Request/Response types

export interface CreateProjectRequest {
  name: string;
  description: string;
  user_stories: string[];
  tech_stack?: string;
}

export interface CreateProjectResponse {
  project_id: string;
  name: string;
  status: string;
  created_at: string;
  story_count: number;
}

export interface StartPipelineResponse {
  project_id: string;
  execution_id: string;
  status: string;
  started_at: string;
}
