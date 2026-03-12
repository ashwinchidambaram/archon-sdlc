# WIPRO SDLC ORCHESTRATOR — Technical Implementation Spec

> **Purpose of this document:** This is the complete blueprint for building a multi-agent AI-powered software development lifecycle (SDLC) orchestrator. It is designed to be consumed by Claude Code as a `CLAUDE.md` file — the single source of truth for architecture, implementation details, design rationale, and phased build plan.

> **Context:** This project is a take-home assignment for an AI Engineering interview at Wipro. It demonstrates a multi-agent system aligned with Wipro's WEGA (Wipro Enterprise Generative AI) platform and their Agentic AI SDLC Orchestrator product on AWS Marketplace. The system must deploy to AWS with minimal manual steps ("one-touch deploy").

> **Demo narrative:** The system takes user stories as input and orchestrates a pipeline of specialized AI agents — Requirements Analysis, Code Generation, Test Generation, Security Scanning, Code Review, and Documentation — with an iterative feedback loop where Code Review can trigger re-generation cycles. To prove the system works, we feed it user stories for a *second* project (an Enterprise Knowledge Onboarding Platform, aligned with Wipro's WINGS platform) and demonstrate it generating real, working code.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Design Decisions & Rationale](#2-design-decisions--rationale)
3. [Tech Stack](#3-tech-stack)
4. [Repository Structure](#4-repository-structure)
5. [AWS Infrastructure (CDK)](#5-aws-infrastructure-cdk)
6. [Agent Specifications](#6-agent-specifications)
7. [Step Functions State Machine](#7-step-functions-state-machine)
8. [API Design](#8-api-design)
9. [Frontend Design](#9-frontend-design)
10. [Data Models](#10-data-models)
11. [Deployment](#11-deployment)
12. [Phased Development Plan](#12-phased-development-plan)
13. [Testing Strategy](#13-testing-strategy)
13a. [Output Validation Tiers](#13a-output-validation-tiers)
14. [Demo Script](#14-demo-script)

---

## 1. Architecture Overview

The system is a **fully serverless multi-agent pipeline** on AWS with an **iterative feedback loop**. User stories enter through a React frontend, flow through an API Gateway to a Step Functions state machine that orchestrates six specialized AI agents (each running as a Lambda function backed by Amazon Bedrock), and produce software artifacts stored in S3 with metadata tracked in DynamoDB.

The pipeline is not a simple linear chain. After Code Review evaluates the generated code, a **Choice state** determines whether to loop back to Code Generation for revisions (up to 2 iterations) or proceed to Documentation. This iterative architecture mirrors real software development workflows and is closer to how Wipro's WEGA platform operates.

The Security Scan agent is **tool-augmented** — it runs `bandit` (a Python static analysis tool) against the generated code first, then uses Bedrock to interpret, contextualize, and extend those findings. This produces higher-quality security analysis than pure LLM review alone.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React + shadcn/ui)                 │
│                     S3 Static Site + CloudFront                     │
│                                                                     │
│  ┌──────────┐  ┌──────────────────┐  ┌───────────────────────────┐ │
│  │  Story    │  │  Pipeline        │  │  Artifact Viewer          │ │
│  │  Input    │  │  Dashboard       │  │  (code, tests, reports)   │ │
│  └────┬─────┘  └────────▲─────────┘  └───────────▲───────────────┘ │
│       │                 │                         │                  │
└───────┼─────────────────┼─────────────────────────┼──────────────────┘
        │                 │                         │
        ▼                 │                         │
┌───────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (HTTP API)                           │
└───────────────────┬──────────────────────▲────────────────────────────┘
                    │                      │
                    ▼                      │
┌───────────────────────────────────────────────────────────────────────┐
│                  STEP FUNCTIONS (Standard Workflow)                    │
│                                                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐            │
│  │ Requirements  │───▶│ Code         │───▶│ Test         │            │
│  │ Agent         │    │ Generation   │    │ Generation   │            │
│  │ (Lambda)      │    │ Agent        │    │ Agent        │            │
│  └──────────────┘    │ (Lambda)     │    │ (Lambda)     │            │
│                       └──────▲───────┘    └──────┬───────┘            │
│                              │                    │                    │
│                    ┌─────────┴────────┐   ┌──────▼───────┐            │
│                    │ FEEDBACK LOOP    │   │ Security     │            │
│                    │                  │   │ Scan Agent   │            │
│                    │ If verdict =     │   │ (Lambda +    │            │
│                    │ CHANGES_REQUESTED│   │  bandit)     │            │
│                    │ AND iteration <2 │   └──────┬───────┘            │
│                    └─────────▲────────┘          │                    │
│                              │            ┌──────▼───────┐            │
│                    ┌─────────┴────────┐   │ Code Review  │            │
│                    │ Choice State     │◀──│ Agent        │            │
│                    └─────────┬────────┘   │ (Lambda)     │            │
│                              │            └──────────────┘            │
│                              │ If APPROVED or max iterations          │
│                              ▼                                        │
│                    ┌──────────────────┐                                │
│                    │ Documentation    │                                │
│                    │ Agent (Lambda)   │                                │
│                    └──────────────────┘                                │
└───────────────────────────────────────────────────────────────────────┘
        │                                           │
        ▼                                           ▼
┌───────────────┐                          ┌────────────────┐
│  DynamoDB     │                          │  S3 Bucket     │
│  (job state,  │                          │  (generated    │
│   metadata)   │                          │   artifacts)   │
└───────────────┘                          └────────────────┘
        │
        ▼
┌───────────────┐
│  Bedrock      │
│  (Claude 3.5  │
│   Sonnet)     │
└───────────────┘
```

### Key architectural properties

- **Each agent is stateless.** It receives input from Step Functions, calls Bedrock, and returns structured output. No agent knows about the others.
- **Step Functions is the orchestrator.** It defines the execution order, passes outputs between agents, handles errors and retries, manages the feedback loop iteration count, and provides built-in execution visualization.
- **The pipeline is iterative, not just linear.** The Code Review → Code Generation feedback loop transforms this from a simple chain into an agentic system that self-corrects. This is the core differentiator versus a naive multi-agent demo.
- **The Security Agent is tool-augmented.** It runs bandit for grounded static analysis before using Bedrock for interpretation. This demonstrates that you know when to use tools versus pure LLM reasoning.
- **DynamoDB tracks project-level state** including iteration counts. Each project has a record with its user stories, current status, and references to generated artifacts in S3.
- **S3 stores all generated artifacts.** Code files, test files, security reports, review reports, and documentation are stored as objects keyed by project ID, stage, and iteration number.
- **The frontend polls for status.** After triggering a pipeline run, the frontend polls the execution status endpoint and updates the dashboard as each stage completes, including showing feedback loop iterations.

---

## 2. Design Decisions & Rationale

### Why fully serverless (Lambda) instead of containers (ECS/EKS)

**Decision:** All backend compute runs on Lambda functions, not containers.

**Rationale:**
- **One-touch deploy:** Lambda code is bundled and deployed directly via CDK. No Docker build step, no ECR image push, no container registry. The user doesn't need Docker installed locally.
- **Cold start is acceptable:** This is a pipeline processing tool, not a real-time API. Each agent takes 10-30 seconds to call Bedrock anyway. Lambda cold starts (~1-3 seconds for Python) are noise compared to Bedrock inference time.
- **Cost efficiency for a demo:** Lambda costs nothing when idle. An ECS Fargate task running 24/7 would cost ~$30-50/month even with no traffic.
- **Simpler infrastructure:** No task definitions, no cluster management, no load balancer health checks, no container networking. Each Lambda is a self-contained unit.

**Tradeoff acknowledged:** Lambda has a 15-minute timeout. If a single Bedrock call exceeds this (unlikely for Sonnet), we'd need to refactor. Lambda also has a 6MB response payload limit for synchronous invocations — but since we're using Step Functions (which supports up to 256KB between states), we write large artifacts to S3 and pass references.

### Why Step Functions instead of a custom Python orchestrator (e.g., LangGraph)

**Decision:** AWS Step Functions Standard Workflow orchestrates the agent pipeline rather than a Python-based framework like LangGraph, Prefect, or Celery.

**Rationale:**
- **Visual execution history for free:** Step Functions provides a real-time visual graph of execution state in the AWS console. This is outstanding demo material — the interviewer can literally watch each stage light up green as agents complete their work. The feedback loop is especially visually compelling — you can see the pipeline cycle back.
- **Built-in error handling:** Retry policies, catch blocks, and fallback states are declarative. No try/except boilerplate in application code.
- **Native iteration support:** Step Functions Choice states and iteration counters handle the feedback loop without custom loop logic. The state machine definition declaratively expresses "if review says changes requested and iteration < 2, go back to code generation."
- **AWS-native integration:** Step Functions can invoke Lambda directly without going through API Gateway. It handles the input/output marshaling and can pass state between steps.
- **Interview alignment:** Wipro's AWS deployment patterns use Step Functions for workflow orchestration. Showing fluency with it demonstrates you can build the way they build.

**Tradeoff acknowledged:** Step Functions has a 256KB payload limit between states. For large generated code files, we must write to S3 and pass the S3 key between states rather than the full content. We handle this by defining a consistent pattern: each agent writes its full output to S3 and returns a metadata object with the S3 key, summary, and status.

### Why Standard Workflow instead of Express Workflow

**Decision:** Use Step Functions Standard Workflow with async execution, not Express Workflow.

**Rationale:**
- **The pipeline takes 3-5 minutes with the feedback loop.** Express Workflows have a 5-minute hard timeout, which is too tight — especially if the feedback loop triggers a second iteration (adding ~60-90 seconds). Standard Workflows support up to one year.
- **API Gateway has a 29-second timeout for HTTP APIs.** Even with Express Workflow's synchronous execution, the API would timeout long before the pipeline completes. We need async execution regardless.
- **Standard Workflows provide persistent execution history.** You can inspect completed executions in the console days later. Express Workflow history is transient.

**Implementation:** The `POST /projects/{id}/run` handler calls `StartExecution`, stores the execution ARN in DynamoDB, and returns immediately. The frontend polls `GET /projects/{id}` every 3 seconds for status updates. Each agent writes its stage result to DynamoDB as it completes, so the frontend sees real-time progress without needing to query Step Functions directly.

### Why Amazon Bedrock (Claude Sonnet) instead of OpenAI or direct Anthropic API

**Decision:** All LLM calls go through Amazon Bedrock using the `anthropic.claude-3-5-sonnet-20241022-v2:0` model.

**Rationale:**
- **AWS-native integration:** Bedrock integrates directly with IAM for auth, CloudWatch for logging, and Lambda's runtime. No API key management, no external network egress, no secrets management complexity.
- **Wipro alignment:** Wipro's PARI PLC Code Generator (published AWS case study) uses Bedrock with Claude 3.5 Sonnet. Their Agentic AI SDLC Orchestrator on AWS Marketplace is built on Bedrock. Using the same stack shows you've done your research.
- **Model access via IAM:** Lambda's execution role gets Bedrock invoke permissions. No API keys to store in Secrets Manager or environment variables.
- **Multi-model flexibility:** The CDK stack could be trivially extended to use Bedrock's other models (Titan, Llama, Mistral) for different agents — cost-optimizing by using cheaper models for simpler tasks. This mirrors WEGA's multi-model architecture.

**Tradeoff acknowledged:** Bedrock model access must be manually enabled in the console before deployment. This is documented in the deployment section as a prerequisite. There is no API or IaC support for enabling model access.

### Why uv instead of pip/poetry/pipenv

**Decision:** Use `uv` for all Python package management.

**Rationale:**
- **Speed:** uv resolves and installs dependencies 10-100x faster than pip. For a one-day build where you're iterating rapidly, this matters.
- **Lockfile support:** `uv.lock` provides deterministic, reproducible builds.
- **Modern standard:** uv supports `pyproject.toml` natively, manages virtual environments automatically, and is increasingly the standard in the Python ecosystem.
- **Lambda compatibility:** For Lambda deployment, we need to install dependencies into a target directory. uv supports this cleanly.

**Implementation note:** Each Lambda function has its own `pyproject.toml`. The CDK build step runs `uv pip install --target ./package` to create the Lambda deployment package. A shared library (`shared/`) is installed in each Lambda's package directory as well.

### Why DynamoDB + S3 instead of Aurora/RDS

**Decision:** DynamoDB for metadata and state tracking, S3 for artifact storage.

**Rationale:**
- **Zero provisioning:** DynamoDB on-demand mode and S3 require no capacity planning, no connection pooling, no VPC configuration.
- **Matches the data model:** Projects and pipeline runs are key-value lookups. There are no complex joins or relational queries. DynamoDB's single-table design pattern handles this cleanly.
- **Lambda-friendly:** DynamoDB connections are stateless HTTP calls. RDS connections from Lambda require RDS Proxy to handle connection pooling.
- **Cost:** DynamoDB on-demand with the traffic volume of a demo costs fractions of a penny.

### Why React + shadcn/ui for the frontend

**Decision:** React SPA with shadcn/ui component library, deployed as a static site to S3 + CloudFront.

**Rationale:**
- **shadcn/ui provides professional UI components out of the box.** Tabs, cards, code blocks, progress indicators, badges — all the components needed for a pipeline dashboard.
- **Static site deployment is trivial.** `npm run build` produces static files. CDK copies them to S3 and creates a CloudFront distribution.
- **Interview polish:** A clean, modern UI significantly elevates the demo quality.

### Why tool-augmented Security Agent instead of pure LLM or full ReAct

**Decision:** The Security Agent runs `bandit` first, then sends findings + source code to Bedrock for interpretation. Other agents remain single-pass LLM calls.

**Rationale:**
- **ReAct is valuable when an agent needs to discover information it doesn't already have.** Most agents (Requirements, Code Gen, Test Gen, Code Review, Documentation) receive complete input context and perform synthesis. They don't need tools.
- **Security analysis genuinely benefits from tooling.** LLM-only code review misses things that AST-based static analysis catches. Bandit provides grounded, deterministic findings. Bedrock adds the interpretation layer — severity assessment, false positive filtering, remediation guidance.
- **Applying ReAct everywhere would triple pipeline latency.** Each ReAct loop means 3-5 Bedrock calls per agent instead of 1. With 6 agents, that's 18-30 Bedrock calls versus 7, pushing the pipeline from 3-5 minutes to 12-20 minutes.
- **The feedback loop is the real agentic behavior.** Inter-agent iteration (Code Review influencing Code Generation) is more architecturally interesting than intra-agent tool chatter.

---

## 3. Tech Stack

### Backend
- **Runtime:** Python 3.12 (Lambda)
- **Package management:** uv
- **AWS SDK:** boto3 (included in Lambda runtime)
- **LLM:** Amazon Bedrock — `anthropic.claude-3-5-sonnet-20241022-v2:0`
- **Static analysis:** bandit (Python security linter, used by Security Agent)
- **Serialization:** Pydantic v2 for all data models and validation

### Infrastructure
- **IaC:** AWS CDK v2 (TypeScript)
- **Orchestration:** AWS Step Functions (Standard Workflow)
- **Compute:** AWS Lambda (Python 3.12, ARM64, 512MB memory, 5-min timeout)
- **API:** Amazon API Gateway (HTTP API)
- **Storage:** Amazon DynamoDB (on-demand), Amazon S3
- **CDN:** Amazon CloudFront
- **Auth:** None for demo (add Cognito later if needed)
- **Logging:** CloudWatch Logs (automatic with Lambda)

### Frontend
- **Framework:** React 18 with TypeScript
- **UI Components:** shadcn/ui
- **Styling:** Tailwind CSS
- **Build:** Vite
- **HTTP Client:** fetch (native)
- **State Management:** React hooks (useState, useEffect, useReducer)

---

## 4. Repository Structure

```
wipro-sdlc-orchestrator/
├── CLAUDE.md                          # This spec (symlink or copy of SPEC.md)
├── README.md                          # GitHub-facing README with demo, architecture, setup
├── LICENSE                            # MIT
├── deploy.sh                          # One-touch deploy script
├── .gitignore
│
├── infrastructure/                    # AWS CDK app (TypeScript)
│   ├── package.json
│   ├── tsconfig.json
│   ├── cdk.json
│   ├── bin/
│   │   └── app.ts                     # CDK app entry point
│   └── lib/
│       ├── sdlc-orchestrator-stack.ts # Main stack — ALL infrastructure
│       └── constructs/
│           ├── api.ts                 # API Gateway + Lambda handlers
│           ├── pipeline.ts            # Step Functions state machine
│           ├── storage.ts             # DynamoDB + S3
│           └── frontend.ts            # S3 + CloudFront static site
│
├── backend/                           # Python Lambda functions
│   ├── pyproject.toml                 # Root pyproject.toml for shared deps
│   ├── uv.lock
│   │
│   ├── shared/                        # Shared library installed in each Lambda
│   │   ├── pyproject.toml
│   │   ├── src/
│   │   │   └── shared/
│   │   │       ├── __init__.py
│   │   │       ├── bedrock.py         # Bedrock client wrapper
│   │   │       ├── models.py          # Pydantic data models
│   │   │       ├── s3.py              # S3 read/write helpers
│   │   │       └── dynamodb.py        # DynamoDB helpers
│   │   └── tests/
│   │       └── test_models.py
│   │
│   ├── agents/                        # One directory per agent Lambda
│   │   ├── requirements_agent/
│   │   │   ├── pyproject.toml
│   │   │   ├── handler.py             # Lambda handler
│   │   │   └── prompt.py              # System prompt definition
│   │   ├── codegen_agent/
│   │   │   ├── pyproject.toml
│   │   │   ├── handler.py
│   │   │   └── prompt.py
│   │   ├── testgen_agent/
│   │   │   ├── pyproject.toml
│   │   │   ├── handler.py
│   │   │   └── prompt.py
│   │   ├── security_agent/
│   │   │   ├── pyproject.toml         # Includes bandit as dependency
│   │   │   ├── handler.py             # Runs bandit, then calls Bedrock
│   │   │   └── prompt.py
│   │   ├── codereview_agent/
│   │   │   ├── pyproject.toml
│   │   │   ├── handler.py
│   │   │   └── prompt.py
│   │   └── documentation_agent/
│   │       ├── pyproject.toml
│   │       ├── handler.py
│   │       └── prompt.py
│   │
│   └── api/                           # API handler Lambdas
│       ├── pyproject.toml
│       ├── create_project.py          # POST /projects
│       ├── start_pipeline.py          # POST /projects/{id}/run
│       ├── get_project.py             # GET /projects/{id}
│       ├── get_stages.py              # GET /projects/{id}/stages
│       └── get_artifact.py            # GET /artifacts/{key}
│
├── frontend/                          # React SPA
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── index.html
│   ├── public/
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/
│       │   └── client.ts              # API client functions
│       ├── components/
│       │   ├── ProjectCreator.tsx      # User story input form
│       │   ├── PipelineDashboard.tsx   # Stage progress + feedback loop viz
│       │   ├── StageDetail.tsx         # Individual stage results
│       │   ├── ArtifactViewer.tsx      # Code/text viewer with syntax highlighting
│       │   └── ui/                     # shadcn/ui components (auto-generated)
│       ├── hooks/
│       │   ├── useProject.ts
│       │   └── usePipelineStatus.ts
│       ├── types/
│       │   └── index.ts               # TypeScript types matching backend models
│       └── lib/
│           └── utils.ts               # shadcn/ui utility functions
│
└── demo/                              # Demo data (Project 6 user stories)
    └── project6-user-stories.json     # Separate file — NOT part of build system
```

---

## 5. AWS Infrastructure (CDK)

### CDK App Entry Point (`infrastructure/bin/app.ts`)

```typescript
import * as cdk from 'aws-cdk-lib';
import { SdlcOrchestratorStack } from '../lib/sdlc-orchestrator-stack';

const app = new cdk.App();
new SdlcOrchestratorStack(app, 'SdlcOrchestratorStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
```

### Main Stack Structure

The main stack composes four constructs:

**StorageConstruct** (`lib/constructs/storage.ts`):
- DynamoDB table: `sdlc-projects`
  - Partition key: `pk` (String) — value format: `PROJECT#<project_id>`
  - Sort key: `sk` (String) — value format: `METADATA`, `STAGE#requirements#iter0`, `STAGE#codegen#iter0`, `STAGE#codegen#iter1`, etc.
  - Billing mode: PAY_PER_REQUEST
  - Removal policy: DESTROY
- S3 bucket: `sdlc-artifacts-<account_id>`
  - Auto-delete objects: true
  - Removal policy: DESTROY
  - CORS: Allow GET/PUT from CloudFront domain
  - Lifecycle: Expire objects after 30 days

**PipelineConstruct** (`lib/constructs/pipeline.ts`):
- Six Lambda functions (one per agent):
  - Runtime: Python 3.12, Architecture: ARM64
  - Memory: 512 MB (1024 MB for Security Agent)
  - Timeout: 5 minutes
  - Environment variables: `ARTIFACTS_BUCKET`, `PROJECTS_TABLE`, `BEDROCK_MODEL_ID`
  - IAM: Bedrock InvokeModel, S3 read/write, DynamoDB read/write
- Step Functions Standard Workflow state machine (see Section 7)

**ApiConstruct** (`lib/constructs/api.ts`):
- API Gateway HTTP API
- Five Lambda handler functions for API routes
- IAM: DynamoDB read/write, S3 read, Step Functions StartExecution + DescribeExecution
- CORS: Allow all origins (demo)

**FrontendConstruct** (`lib/constructs/frontend.ts`):
- S3 bucket for static website hosting
- CloudFront distribution with SPA routing (403/404 → index.html)
- BucketDeployment from `frontend/dist/`
- API_URL injected at build time

### Lambda Build Strategy

**Avoid Docker.** The `deploy.sh` script pre-builds each Lambda's package directory using `uv pip install --target` before `cdk deploy`. CDK's `Code.fromAsset()` points to the pre-built directory. This keeps the deploy script simple and Docker-free.

---

## 6. Agent Specifications

Each agent follows the same contract:

**Input** (from Step Functions):
```json
{
  "project_id": "string",
  "execution_id": "string",
  "iteration": 0,
  "project_context": {
    "name": "string",
    "description": "string",
    "user_stories": ["string"],
    "tech_stack": "string"
  },
  "previous_stages": {
    "requirements": { "s3_key": "string", "summary": "string" },
    "codegen": { "s3_key": "string", "summary": "string" },
    "codereview": { "s3_key": "string", "summary": "string", "verdict": "string" }
  }
}
```

**Output** (returned to Step Functions):
```json
{
  "stage": "string",
  "status": "completed" | "failed",
  "s3_key": "string",
  "summary": "string",
  "iteration": 0,
  "verdict": "APPROVED | APPROVED_WITH_COMMENTS | CHANGES_REQUESTED",
  "metadata": {
    "model_id": "string",
    "input_tokens": 0,
    "output_tokens": 0,
    "duration_seconds": 0.0
  }
}
```

The `verdict` field is only populated by the Code Review agent. Step Functions uses it in the Choice state to determine whether to loop or proceed.

Each agent:
1. Reads its input from the Step Functions event
2. If it needs outputs from previous stages, fetches them from S3 using the `s3_key`
3. Constructs its prompt using the system prompt + contextual data
4. Calls Bedrock (and/or tools like bandit for the Security Agent)
5. Parses the response
6. Writes full output to S3 at `{project_id}/{stage}/iter{N}/{filename}`
7. Writes a stage record to DynamoDB (for API queries)
8. Returns the output contract to Step Functions

### Agent 1: Requirements Agent

**Purpose:** Transform user stories into detailed technical specifications.

**S3 output file:** `{project_id}/requirements/technical-spec.md`

**System Prompt:**

```
You are a Senior Solutions Architect working within an enterprise AI consulting firm's SDLC automation platform. Your role is to transform user stories into comprehensive technical specifications that downstream code generation agents can implement directly.

## Your Task

Given a set of user stories and project context, produce a detailed technical specification document in Markdown format. The spec must be precise enough that a code generation system can produce working code from it without ambiguity.

## Output Structure

Your response must be a valid Markdown document with exactly these sections:

### 1. System Overview
- One-paragraph summary of what the system does
- Primary users and their goals
- Key architectural constraints

### 2. Architecture
- High-level component diagram (described textually)
- Technology choices justified by the tech stack constraint
- Data flow between components

### 3. Data Models
- For each entity: field name, type, constraints, relationships
- Use Python type annotations (e.g., `name: str`, `created_at: datetime`)
- Include Pydantic model definitions

### 4. API Endpoints
- For each endpoint: HTTP method, path, request body schema, response schema, error cases
- Use OpenAPI-style descriptions
- Group by resource

### 5. Component Specifications
- For each component/module: purpose, public interface, dependencies, key algorithms
- Map each user story to the component(s) that implement it

### 6. Acceptance Criteria
- For each user story: testable acceptance criteria (Given/When/Then format)
- Edge cases and error scenarios

### 7. Technical Constraints & Assumptions
- External service dependencies
- Performance requirements
- Security considerations

## Rules
- Be extremely specific. Do not use vague language like "appropriate" or "as needed."
- Every user story must map to at least one component and one API endpoint.
- Data models must include all fields — do not say "and other relevant fields."
- API schemas must include example values.
- If the user stories are ambiguous, make a reasonable assumption and state it explicitly.
```

### Agent 2: Code Generation Agent

**Purpose:** Generate implementation code from the technical specification. On iteration 0, generates from scratch. On iteration 1+, revises based on Code Review feedback.

**S3 output:** `{project_id}/codegen/iter{N}/` directory with all files + `manifest.json`

**Handler logic for feedback loop:**
```python
def lambda_handler(event, context):
    iteration = event.get("iteration", 0)
    previous_stages = event.get("previous_stages", {})

    # Always read the requirements spec
    spec = read_from_s3(previous_stages["requirements"]["s3_key"])

    if iteration == 0 or "codereview" not in previous_stages or previous_stages.get("codereview") is None:
        # First pass: generate from scratch
        user_message = f"Here is the technical specification:\n\n{spec}\n\nGenerate the complete implementation."
    else:
        # Revision pass: include previous code + review feedback
        previous_code = read_from_s3(previous_stages["codegen"]["s3_key"])
        review_feedback = read_from_s3(previous_stages["codereview"]["s3_key"])
        user_message = (
            f"Here is the technical specification:\n\n{spec}\n\n"
            f"Here is the code from the previous iteration:\n\n{previous_code}\n\n"
            f"Here is the code review feedback. Fix ALL issues marked P1 and P2:\n\n{review_feedback}\n\n"
            f"Generate the revised implementation addressing all review feedback."
        )

    response = invoke_bedrock(SYSTEM_PROMPT, user_message)
    files = parse_file_list(response)

    # ── LEVEL 1 VALIDATION (mandatory) ─────────────────────────────
    # Syntax-check every generated Python file using ast.parse().
    # This is cheap (no dependencies, instant) and proves the output
    # is not garbage. Validation errors are NOT fatal — they are
    # recorded in the manifest so the Code Review agent sees them
    # and triggers the feedback loop for fixes.
    validation_results = []
    for file_info in files:
        if file_info["path"].endswith(".py"):
            try:
                import ast
                ast.parse(file_info["content"])
                validation_results.append({"file": file_info["path"], "valid": True})
            except SyntaxError as e:
                validation_results.append({
                    "file": file_info["path"],
                    "valid": False,
                    "error": f"Line {e.lineno}: {e.msg}"
                })

    invalid_files = [r for r in validation_results if not r["valid"]]

    manifest = {
        "files": files,
        "summary": response_summary,
        "revision_notes": revision_notes if iteration > 0 else None,
        "validation": {
            "total_python_files": len(validation_results),
            "valid": len(validation_results) - len(invalid_files),
            "invalid": len(invalid_files),
            "errors": invalid_files
        }
    }
    # Write manifest + individual files to S3, write stage result to DynamoDB, return AgentOutput
```

**System Prompt:**

```
You are a Senior Software Engineer working within an enterprise AI consulting firm's SDLC automation platform. Your role is to generate production-quality implementation code from technical specifications.

You may be called in two modes:
1. **Initial generation**: You receive a technical specification and generate the complete implementation from scratch.
2. **Revision**: You receive a technical specification, your previous code, and code review feedback. You must fix all P1 and P2 issues identified in the review while preserving the overall architecture.

## Output Format

Respond with a JSON object containing a list of files to generate. Each file has a `path` (relative to project root), `description`, and `content` (the full file contents).

```json
{
  "files": [
    {
      "path": "src/models.py",
      "description": "Pydantic data models for all entities",
      "content": "from pydantic import BaseModel, Field\n..."
    }
  ],
  "summary": "Brief description of what was generated and any notable decisions",
  "revision_notes": "If this is a revision, describe what changed and which review issues were addressed"
}
```

## Code Quality Rules
- Every file must be syntactically valid and importable.
- Use type hints on all function signatures.
- Include docstrings on all public functions and classes.
- Follow PEP 8 for Python or equivalent style guide for the target language.
- Handle errors explicitly — no bare `except:` blocks.
- Use dependency injection patterns where appropriate.
- Include a `requirements.txt` or `pyproject.toml` with all dependencies and their versions.
- Include a `README.md` with setup instructions.

## Architecture Rules
- Separate concerns: models, routes/handlers, services/business logic, utilities.
- Use environment variables for configuration.
- Include logging with structured output.
- Database interactions should use an ORM or query builder, not raw SQL strings.

## Revision Rules (when fixing review feedback)
- Address every P1 and P2 issue explicitly.
- Do not introduce regressions — preserve working functionality.
- Regenerate the complete file when making changes, do not output diffs or patches.

## What NOT To Do
- Do not generate placeholder code with `# TODO` comments. Every function must be fully implemented.
- Do not skip error handling.
- Do not hardcode configuration values.
- Do not generate test files — that is handled by a separate agent.
```

### Agent 3: Test Generation Agent

**Purpose:** Generate comprehensive test suites for the generated code.

**S3 output:** `{project_id}/testgen/iter{N}/` directory with test files + `manifest.json`

**System Prompt:**

```
You are a Senior QA Engineer working within an enterprise AI consulting firm's SDLC automation platform. Your role is to generate comprehensive test suites for application code.

## Your Task

Given a technical specification and the implementation code, produce a complete test suite.

## Output Format

Respond with a JSON object containing test files:

```json
{
  "files": [
    {
      "path": "tests/test_models.py",
      "description": "Unit tests for data models",
      "content": "import pytest\nfrom src.models import ..."
    }
  ],
  "summary": "Test coverage summary",
  "coverage_estimate": {
    "unit_tests": 15,
    "integration_tests": 8,
    "edge_case_tests": 12,
    "total": 35
  }
}
```

## Test Quality Rules
- Use pytest as the test framework.
- Every public function must have at least one test.
- Every API endpoint must have tests for: success case, validation error, not found, and server error.
- Every acceptance criterion from the spec must map to at least one test.
- Use fixtures for shared setup.
- Use parameterized tests for similar test cases with different inputs.
- Mock external dependencies (databases, APIs, file systems).
- Test names must follow: `test_<function>_<scenario>_<expected_outcome>`

## Coverage Priorities
1. Data model validation (required fields, type constraints, edge cases)
2. API endpoint behavior (happy path, error codes, input validation)
3. Business logic correctness
4. Error handling (what happens when dependencies fail)
5. Edge cases (empty inputs, maximum values, concurrent access)
```

### Agent 4: Security Scan Agent (Tool-Augmented)

**Purpose:** Perform static security analysis using both bandit (automated tooling) and Bedrock (AI interpretation).

**S3 output:** `{project_id}/security/iter{N}/security-report.json`

**Handler logic (two-step process):**
```python
import subprocess
import json
import tempfile
import os

def lambda_handler(event, context):
    previous_stages = event.get("previous_stages", {})
    
    # Step 1: Fetch generated code from S3 and write to temp directory
    code_manifest = read_json_from_s3(previous_stages["codegen"]["s3_key"])
    
    with tempfile.TemporaryDirectory() as tmpdir:
        for file_info in code_manifest["files"]:
            filepath = os.path.join(tmpdir, file_info["path"])
            os.makedirs(os.path.dirname(filepath), exist_ok=True)
            with open(filepath, "w") as f:
                f.write(file_info["content"])
        
        # Step 2: Run bandit
        bandit_result = subprocess.run(
            ["bandit", "-r", tmpdir, "-f", "json", "--severity-level", "low"],
            capture_output=True, text=True, timeout=60
        )
        
        try:
            bandit_findings = json.loads(bandit_result.stdout)
        except json.JSONDecodeError:
            bandit_findings = {"results": [], "errors": [bandit_result.stderr]}
    
    # Step 3: Send bandit findings + source code to Bedrock
    code_summary = format_code_for_prompt(code_manifest)
    bandit_summary = json.dumps(bandit_findings, indent=2)
    
    user_message = (
        f"## Source Code\n\n{code_summary}\n\n"
        f"## Bandit Static Analysis Results\n\n{bandit_summary}\n\n"
        f"Analyze the code and bandit findings. Provide your security assessment."
    )
    
    response = invoke_bedrock(SYSTEM_PROMPT, user_message)
    # ... parse, write to S3, return output
```

**IMPORTANT:** Security Agent Lambda needs **1024 MB memory** to accommodate bandit execution.

**System Prompt:**

```
You are a Senior Application Security Engineer working within an enterprise AI consulting firm's SDLC automation platform. Your role is to perform thorough security analysis combining automated tool findings with expert assessment.

## Your Task

You receive two inputs:
1. **Source code** for the application under review
2. **Bandit static analysis results** — automated findings from the bandit Python security linter

Your job is to:
- Interpret and contextualize the bandit findings (assess true severity, filter false positives)
- Identify additional vulnerabilities that bandit cannot detect (logic flaws, architectural issues, business logic vulnerabilities)
- Provide actionable remediation guidance for all confirmed findings

## Analysis Categories

Beyond the bandit results, also check for:
1. **Injection Vulnerabilities:** SQL injection, command injection, XSS, template injection
2. **Authentication & Authorization:** Hardcoded credentials, missing auth checks, insecure token handling
3. **Data Exposure:** Sensitive data in logs, unencrypted storage, PII handling
4. **Configuration Security:** Debug mode, insecure defaults, missing security headers, CORS misconfiguration
5. **Input Validation:** Missing validation, insufficient sanitization
6. **Error Handling:** Information leakage in error messages, stack traces exposed

## Output Format

```json
{
  "summary": {
    "total_findings": 5,
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 2,
    "info": 0,
    "false_positives_filtered": 1,
    "overall_risk": "MEDIUM"
  },
  "bandit_analysis": {
    "total_bandit_findings": 3,
    "confirmed": 2,
    "false_positives": 1,
    "details": [
      {
        "bandit_id": "B608",
        "bandit_severity": "MEDIUM",
        "assessed_severity": "LOW",
        "rationale": "The SQL query uses parameterized inputs via ORM, bandit flagged the string format but it is a false positive in this context",
        "is_false_positive": true
      }
    ]
  },
  "findings": [
    {
      "id": "SEC-001",
      "severity": "HIGH",
      "category": "Injection",
      "source": "bandit" | "manual_review",
      "title": "SQL injection in user search endpoint",
      "file": "src/routes/users.py",
      "line_range": "45-52",
      "description": "User input is concatenated directly into SQL query without parameterization.",
      "evidence": "query = f'SELECT * FROM users WHERE name = {name}'",
      "remediation": "Use parameterized queries via ORM or cursor.execute with parameters.",
      "references": ["CWE-89", "OWASP A03:2021"]
    }
  ],
  "positive_observations": [
    "Application uses environment variables for configuration",
    "Pydantic models provide input validation at API boundary"
  ]
}
```

## Rules
- Every bandit finding must be assessed — confirmed with your severity rating or marked as false positive with rationale.
- Additional findings from manual review must be labeled `"source": "manual_review"`.
- Every finding must include a specific file, line range, and concrete remediation.
- Do not report theoretical risks without evidence in the code.
- Include positive observations — things the code does well from a security perspective.
```

### Agent 5: Code Review Agent

**Purpose:** Review all generated artifacts. Its verdict determines whether the pipeline loops back for revisions or proceeds to documentation.

**S3 output:** `{project_id}/codereview/iter{N}/review-report.json`

**CRITICAL: The `verdict` field in the output drives the feedback loop.** It must be returned at the top level of the AgentOutput so Step Functions can read it in the EvaluateReview Choice state.

**System Prompt:**

```
You are a Principal Engineer working within an enterprise AI consulting firm's SDLC automation platform. Your role is to perform comprehensive code reviews.

Your verdict determines what happens next:
- **APPROVED**: Code proceeds to documentation. Use when score >= 8 and no P1 issues.
- **APPROVED_WITH_COMMENTS**: Code proceeds to documentation with comments. Use when score >= 6 and no P1 issues.
- **CHANGES_REQUESTED**: Code is sent back for revision. Use when there are P1 issues or score < 6.

Be calibrated. A prototype/demo does not need banking-platform standards. Focus P1 issues on runtime failures, security vulnerabilities, or fundamental architecture problems.

## Review Dimensions (rate 1-10 each)

1. **Spec Compliance:** Does code implement all requirements?
2. **Code Quality:** Clean, readable, maintainable?
3. **Architecture:** Well-structured, concerns separated?
4. **Error Handling:** Graceful, resilient?
5. **Test Coverage:** Acceptance criteria covered?
6. **Security Posture:** Synthesize security report findings.
7. **Production Readiness:** Logging, config, health checks?

## Output Format

```json
{
  "overall_score": 7.5,
  "verdict": "APPROVED" | "APPROVED_WITH_COMMENTS" | "CHANGES_REQUESTED",
  "summary": "2-3 sentence overall assessment",
  "dimensions": {
    "spec_compliance": { "score": 8, "feedback": "...", "gaps": [] },
    "code_quality": { "score": 7, "feedback": "...", "issues": [] },
    "architecture": { "score": 8, "feedback": "...", "suggestions": [] },
    "error_handling": { "score": 6, "feedback": "...", "issues": [] },
    "test_coverage": { "score": 7, "feedback": "...", "missing_tests": [] },
    "security_posture": { "score": 7, "feedback": "...", "critical_issues": [] },
    "production_readiness": { "score": 6, "feedback": "...", "blockers": [] }
  },
  "top_issues": [
    { "priority": "P1", "description": "...", "file": "...", "suggestion": "..." }
  ],
  "commendations": ["Well-structured data models with comprehensive validation"]
}
```

## Rules
- Be specific — reference file names, function names, line numbers.
- P1 = runtime failure, security vulnerability, or fundamental flaw. P2 = should fix. P3 = nice to have.
- Include commendations.
- Your verdict controls the feedback loop. CHANGES_REQUESTED sends code back (up to 2 iterations). Be judicious.
```

### Agent 6: Documentation Agent

**Purpose:** Generate comprehensive project documentation from the final artifacts. Runs only after the feedback loop converges.

**S3 output:** `{project_id}/documentation/README.md` and `{project_id}/documentation/API.md`

**System Prompt:**

```
You are a Senior Technical Writer working within an enterprise AI consulting firm's SDLC automation platform. Your role is to generate comprehensive, professional documentation.

## Your Task

Given all project artifacts (spec, code, tests, security report, code review), produce complete project documentation.

## Output Format

```json
{
  "files": [
    {
      "path": "README.md",
      "description": "Main project documentation",
      "content": "# Project Name\n..."
    },
    {
      "path": "docs/API.md",
      "description": "API reference documentation",
      "content": "# API Reference\n..."
    }
  ],
  "summary": "Documentation coverage summary"
}
```

## README.md Structure
1. **Header:** Name, badges, one-line description
2. **Architecture Overview:** Diagram (ASCII/Mermaid), components, tech stack
3. **Getting Started:** Prerequisites, install, env vars table, quick start
4. **API Documentation:** Each endpoint with curl examples
5. **Project Structure:** Directory tree with descriptions
6. **Development:** Run tests, add features, code style
7. **Security Considerations:** Measures in place, limitations
8. **License:** MIT

## Rules
- Write for a developer audience.
- Include actual code examples, not placeholders.
- Reference specific files and modules from the generated code.
- Keep it professional but concise.
```

---

## 7. Step Functions State Machine

```json
{
  "Comment": "SDLC Orchestrator Pipeline — 6 agents with feedback loop",
  "StartAt": "InitializePipeline",
  "States": {
    "InitializePipeline": {
      "Type": "Pass",
      "Result": 0,
      "ResultPath": "$.iteration",
      "Next": "RequirementsAnalysis"
    },
    "RequirementsAnalysis": {
      "Type": "Task",
      "Resource": "${RequirementsAgentArn}",
      "Parameters": {
        "project_id.$": "$.project_id",
        "execution_id.$": "$$.Execution.Id",
        "iteration.$": "$.iteration",
        "project_context.$": "$.project_context",
        "previous_stages": {}
      },
      "ResultPath": "$.stages.requirements",
      "Retry": [{ "ErrorEquals": ["Lambda.ServiceException", "Lambda.AWSLambdaException"], "IntervalSeconds": 5, "MaxAttempts": 2, "BackoffRate": 2 }],
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "PipelineFailed" }],
      "Next": "CodeGeneration"
    },
    "CodeGeneration": {
      "Type": "Task",
      "Resource": "${CodeGenAgentArn}",
      "Parameters": {
        "project_id.$": "$.project_id",
        "execution_id.$": "$$.Execution.Id",
        "iteration.$": "$.iteration",
        "project_context.$": "$.project_context",
        "previous_stages": {
          "requirements.$": "$.stages.requirements",
          "codegen.$": "$.stages.codegen",
          "codereview.$": "$.stages.codereview"
        }
      },
      "ResultPath": "$.stages.codegen",
      "Retry": [{ "ErrorEquals": ["Lambda.ServiceException", "Lambda.AWSLambdaException"], "IntervalSeconds": 5, "MaxAttempts": 2, "BackoffRate": 2 }],
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "PipelineFailed" }],
      "Next": "ParallelAnalysis"
    },
    "ParallelAnalysis": {
      "Type": "Parallel",
      "Branches": [
        {
          "StartAt": "TestGeneration",
          "States": {
            "TestGeneration": {
              "Type": "Task",
              "Resource": "${TestGenAgentArn}",
              "Parameters": {
                "project_id.$": "$.project_id",
                "execution_id.$": "$$.Execution.Id",
                "iteration.$": "$.iteration",
                "project_context.$": "$.project_context",
                "previous_stages": {
                  "requirements.$": "$.stages.requirements",
                  "codegen.$": "$.stages.codegen"
                }
              },
              "End": true
            }
          }
        },
        {
          "StartAt": "SecurityScan",
          "States": {
            "SecurityScan": {
              "Type": "Task",
              "Resource": "${SecurityAgentArn}",
              "Parameters": {
                "project_id.$": "$.project_id",
                "execution_id.$": "$$.Execution.Id",
                "iteration.$": "$.iteration",
                "project_context.$": "$.project_context",
                "previous_stages": {
                  "codegen.$": "$.stages.codegen"
                }
              },
              "End": true
            }
          }
        }
      ],
      "ResultPath": "$.stages.parallel",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "PipelineFailed" }],
      "Next": "CodeReview"
    },
    "CodeReview": {
      "Type": "Task",
      "Resource": "${CodeReviewAgentArn}",
      "Parameters": {
        "project_id.$": "$.project_id",
        "execution_id.$": "$$.Execution.Id",
        "iteration.$": "$.iteration",
        "project_context.$": "$.project_context",
        "previous_stages": {
          "requirements.$": "$.stages.requirements",
          "codegen.$": "$.stages.codegen",
          "testgen.$": "$.stages.parallel[0]",
          "security.$": "$.stages.parallel[1]"
        }
      },
      "ResultPath": "$.stages.codereview",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "PipelineFailed" }],
      "Next": "EvaluateReview"
    },
    "EvaluateReview": {
      "Type": "Choice",
      "Choices": [
        {
          "And": [
            { "Variable": "$.stages.codereview.verdict", "StringEquals": "CHANGES_REQUESTED" },
            { "Variable": "$.iteration", "NumericLessThan": 2 }
          ],
          "Next": "IncrementIteration"
        }
      ],
      "Default": "Documentation"
    },
    "IncrementIteration": {
      "Type": "Pass",
      "Parameters": {
        "project_id.$": "$.project_id",
        "project_context.$": "$.project_context",
        "stages.$": "$.stages",
        "iteration.$": "States.MathAdd($.iteration, 1)"
      },
      "Next": "CodeGeneration"
    },
    "Documentation": {
      "Type": "Task",
      "Resource": "${DocumentationAgentArn}",
      "Parameters": {
        "project_id.$": "$.project_id",
        "execution_id.$": "$$.Execution.Id",
        "iteration.$": "$.iteration",
        "project_context.$": "$.project_context",
        "previous_stages": {
          "requirements.$": "$.stages.requirements",
          "codegen.$": "$.stages.codegen",
          "testgen.$": "$.stages.parallel[0]",
          "security.$": "$.stages.parallel[1]",
          "codereview.$": "$.stages.codereview"
        }
      },
      "ResultPath": "$.stages.documentation",
      "Catch": [{ "ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": "PipelineFailed" }],
      "Next": "PipelineSucceeded"
    },
    "PipelineSucceeded": { "Type": "Succeed" },
    "PipelineFailed": { "Type": "Fail", "Error": "PipelineExecutionFailed", "Cause": "One or more pipeline stages failed" }
  }
}
```

**Key notes:**
- `InitializePipeline` sets iteration to 0.
- `EvaluateReview` checks: verdict == CHANGES_REQUESTED AND iteration < 2. If true, loops back. Otherwise proceeds to Documentation.
- `IncrementIteration` uses `States.MathAdd` intrinsic. If this fails, use a small Lambda instead.
- On iteration 0, `$.stages.codegen` and `$.stages.codereview` won't exist. The Code Gen handler must check for missing keys gracefully.
- Parallel results are at `$.stages.parallel[0]` (testgen) and `$.stages.parallel[1]` (security).

---

## 8. API Design

### `POST /projects`
Create a new project. Request: `{ name, description, user_stories[], tech_stack }`. Response (201): `{ project_id, name, status: "created", created_at, story_count }`.

### `POST /projects/{project_id}/run`
Start pipeline. Calls `StartExecution` on Step Functions, stores execution ARN in DynamoDB. Response (202): `{ project_id, execution_id, status: "running", started_at }`.

### `GET /projects/{project_id}`
Get project + status + all stage results including iterations. Queries DynamoDB for metadata + all STAGE# records. If running, also calls `DescribeExecution`. Response includes `iteration` field and per-stage iteration info.

### `GET /projects/{project_id}/stages`
Get all stage results including all iterations, sorted by stage then iteration.

### `GET /artifacts/{s3_key}`
Retrieve artifact from S3. Return with appropriate Content-Type.

---

## 9. Frontend Design

Three views navigated by tabs:

**View 1: Project Creator** — Form with name, description, tech stack, dynamic user story list, "Start Pipeline" button.

**View 2: Pipeline Dashboard** — Visual pipeline showing all 6 stages. Parallel branches for TestGen + Security. Feedback loop indicator when Code Review returns CHANGES_REQUESTED (show iteration badge on Code Gen, loop arrow animation). Each stage shows status (pending/running/completed/failed/re-running), summary, duration, and iteration number. Auto-poll every 3 seconds while running.

**View 3: Artifact Viewer** — Tabbed per stage. Iteration selector for stages that ran multiple times. Markdown rendering for spec and docs. Syntax-highlighted code. Formatted JSON for security report (with bandit vs manual source badges) and code review (dimension progress bars, verdict banner).

Use shadcn/ui: Card, Badge, Tabs, Button, Input, Textarea, Label, Progress, ScrollArea, Alert, Separator, Select.

---

## 10. Data Models

### Pydantic Models (backend/shared/src/shared/models.py)

```python
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
```

### DynamoDB Schema (single-table, iteration-aware)

| pk | sk | Key Attributes |
|---|---|---|
| `PROJECT#<id>` | `METADATA` | name, description, user_stories, tech_stack, status, execution_arn, current_iteration |
| `PROJECT#<id>` | `STAGE#requirements#iter0` | status, s3_key, summary, metadata |
| `PROJECT#<id>` | `STAGE#codegen#iter0` | status, s3_key, summary, metadata |
| `PROJECT#<id>` | `STAGE#codegen#iter1` | status, s3_key, summary, revision_notes, metadata |
| `PROJECT#<id>` | `STAGE#testgen#iter0` | status, s3_key, summary, metadata |
| `PROJECT#<id>` | `STAGE#security#iter0` | status, s3_key, summary, bandit_findings, metadata |
| `PROJECT#<id>` | `STAGE#codereview#iter0` | status, s3_key, summary, verdict, overall_score, metadata |
| `PROJECT#<id>` | `STAGE#codereview#iter1` | status, s3_key, summary, verdict, overall_score, metadata |
| `PROJECT#<id>` | `STAGE#documentation#iter0` | status, s3_key, summary, metadata |

**Access patterns:**
- Get project: `pk = PROJECT#<id>, sk = METADATA`
- Get all stages: `pk = PROJECT#<id>, sk begins_with STAGE#`
- Get specific stage + iteration: `pk = PROJECT#<id>, sk = STAGE#<name>#iter<N>`
- Get all iterations of a stage: `pk = PROJECT#<id>, sk begins_with STAGE#<name>#`

---

## 11. Deployment

### Prerequisites
1. AWS CLI configured with admin access
2. Bedrock Model Access enabled: `Anthropic Claude 3.5 Sonnet v2` in the console
3. Node.js 18+, Python 3.12+, uv installed

### One-Touch Deploy
```bash
git clone https://github.com/youruser/wipro-sdlc-orchestrator
cd wipro-sdlc-orchestrator
./deploy.sh
```

The `deploy.sh` script: checks prerequisites → installs backend deps into package dirs → builds frontend → runs `cdk bootstrap` + `cdk deploy` → prints App URL and API URL.

### Cleanup
```bash
cd infrastructure && npx cdk destroy --force
```

---

## 12. Phased Development Plan

### Phase 0: Project Scaffolding (30 min)

**Goal:** Repository structure, dependency files, configuration.

**Tasks:**
1. Create full directory structure from Section 4
2. Initialize `pyproject.toml` for backend, shared, and each of 6 agents (security_agent includes `bandit`)
3. Initialize `package.json` for infrastructure (CDK) and frontend (Vite + React)
4. Create `.gitignore`
5. Create placeholder `handler.py` for all 6 agent Lambdas (return mock AgentOutput)
6. Create placeholder API handler files
7. Set up shared library with Pydantic models from Section 10
8. Verify `uv sync` and `npm install` work

**Milestone:** All deps install. Shared models importable. All 6 agent dirs exist with stubs.

---

### Phase 1: Infrastructure + Feedback Loop (1.5-2 hours)

**Goal:** Full CDK stack deployed. The entire pipeline including feedback loop works with mock agents.

**Tasks:**
1. Implement StorageConstruct — DynamoDB table + S3 bucket
2. Implement PipelineConstruct:
   - 6 Lambda functions with placeholder handlers
   - Step Functions state machine from Section 7 — **including feedback loop (Choice state, IncrementIteration, loop back)**
   - Mock Code Review returns APPROVED by default
3. Implement ApiConstruct — API Gateway + handler Lambdas
4. Implement FrontendConstruct — S3 + CloudFront with placeholder index.html
5. Wire stack together, add IAM permissions, add CDK outputs
6. Deploy and verify:
   - `cdk deploy` succeeds
   - Step Functions pipeline completes with mock agents
   - **Test feedback loop:** Manually edit mock Code Review to return CHANGES_REQUESTED → verify loop back to Code Gen → verify proceeds after second review

**Milestone:** Full pipeline works with mocks. Feedback loop verified. API responds.

---

### Phase 2: Shared Library + Bedrock Integration (1 hour)

**Goal:** Reliable Bedrock calling and storage helpers.

**Tasks:**
1. `shared/bedrock.py` — invoke_model with retry logic, token counting, timing
2. `shared/s3.py` — read/write artifacts and JSON
3. `shared/dynamodb.py` — CRUD for projects and stage results (iteration-aware)
4. Unit tests for models and helpers (mock boto3)

**Milestone:** Can call Bedrock from test script. Storage helpers work.

---

### Phase 3: Agent Implementation (2.5-3 hours)

**Goal:** All 6 agents produce real output. Feedback loop works end-to-end with Bedrock.

**Build in this order, deploying and testing after each:**

**3a. Requirements Agent** (~30 min)
- Implement prompt.py + handler.py
- Deploy, test via Step Functions console
- Verify: well-structured Markdown spec

**3b. Code Generation Agent** (~45 min)
- Implement with **dual-mode logic** (initial generation vs revision)
- **Implement Level 1 validation:** `ast.parse()` on all generated Python files, results in manifest (see Section 6 handler code and Section 13a)
- Handle missing `previous_stages.codereview` on iteration 0 gracefully
- Deploy, test full pipeline through codegen
- Verify: syntactically valid code files, manifest.json includes validation results

**3c. Test Generation Agent** (~30 min)
- Reads spec + code, produces pytest files
- Deploy, test through testgen

**3d. Security Scan Agent** (~45 min, most complex)
- Add bandit dependency
- Implement two-step handler: bandit subprocess → Bedrock interpretation
- Use /tmp for writing code files (Lambda writable dir)
- **Lambda needs 1024 MB memory**
- Deploy, verify bandit output in report + Bedrock interpretation

**3e. Code Review Agent** (~30 min)
- Reads ALL artifacts, produces review JSON with **verdict**
- Verify verdict drives EvaluateReview Choice state correctly
- Test: APPROVED proceeds to Documentation, CHANGES_REQUESTED loops back

**3f. Documentation Agent** (~20 min)
- Reads all artifacts, produces README.md + API.md
- Simplest agent — single Bedrock call
- Deploy, verify complete pipeline end-to-end

**After each agent:** redeploy and run full pipeline. Don't batch.

**Milestone:** Full 6-agent pipeline with real Bedrock calls. Feedback loop triggers and resolves. Security report includes bandit findings. Documentation generated.

---

### Phase 4: API Handlers (1 hour)

**Goal:** All API endpoints functional for frontend consumption.

**Tasks:**
1. `create_project.py` — validate, generate ID, write DynamoDB, return summary
2. `start_pipeline.py` — read project, start Step Functions, update status, return execution ID
3. `get_project.py` — read metadata + all stage results (all iterations), query execution status
4. `get_stages.py` — return all stage results sorted by stage + iteration
5. `get_artifact.py` — read from S3 with correct Content-Type

**Milestone:** Full API works via curl. Can observe feedback loop iterations via GET /projects/{id}.

---

### Phase 5: Frontend (2-3 hours)

**Goal:** Polished React UI with feedback loop visualization.

**Tasks:**
1. Set up React + Vite + TypeScript + Tailwind + shadcn/ui
2. Install components: Card, Badge, Tabs, Button, Input, Textarea, Progress, ScrollArea, Alert, Select
3. API client + TypeScript types
4. ProjectCreator — form with dynamic story list
5. PipelineDashboard:
   - 6 stage cards with status indicators
   - Parallel branch visualization for TestGen + Security
   - **Feedback loop visualization:** iteration badge on Code Gen, loop indicator when CHANGES_REQUESTED, re-running state (amber)
   - Auto-poll every 3 seconds
6. ArtifactViewer:
   - Tab per stage, iteration selector for multi-iteration stages
   - Markdown rendering, syntax highlighting, formatted JSON
   - Security report with bandit vs manual source badges
   - Code review with dimension progress bars + verdict
7. Wire together in App.tsx

**Milestone:** Complete user flow including feedback loop visualization.

---

### Phase 6: Polish + Demo Prep (1 hour)

**Goal:** GitHub-ready, demo-ready.

**Tasks:**
1. Write README.md (architecture, features, deploy instructions, Wipro alignment)
2. Finalize deploy.sh, test from clean clone
3. Copy demo/project6-user-stories.json into repo
4. Run full demo with Project 6 stories
5. Verify feedback loop triggers at least once (adjust Code Review prompt if needed)
6. **Verify Level 1 validation:** Check Code Gen manifest includes validation results, all files pass syntax check
7. Screenshots for README
8. Clean up debug code
9. Final git push

**Milestone:** Complete. Ship it.

---

### Phase 7: Validation Stretch Goals (IF time allows — check gates first)

**This phase is optional.** Only proceed if the core system (Phases 0-6) is solid, demo-ready, and you have time remaining.

**7a. Evaluate Level 2 gate (15 min decision):**
Review the Level 2 gate criteria in Section 13a. If ALL gates pass:
- Add dependency resolution check to Code Gen handler (~30 min)
- Redeploy, run pipeline, verify dependency check output in manifest
- Update Code Review prompt to flag dependency mismatches

If any gate fails → skip, add to README "Future Enhancements."

**7b. Evaluate Level 3 gate (15 min spike + decision):**
Review the Level 3 gate criteria in Section 13a. Run the spike test FIRST:
- Create a throwaway Lambda, write a Python file to /tmp, pip install pytest to /tmp/packages, run pytest as subprocess
- If spike succeeds AND all other gates pass:
  - Build Test Execution Agent (~1-1.5 hours)
  - Update Step Functions state machine to include it
  - Update Code Review prompt to incorporate test results
  - Redeploy, test full pipeline

If spike fails or any gate fails → skip, add architecture description to README "Future Enhancements."

**Milestone:** Enhanced validation demonstrating deeper code quality verification. Or a well-documented "Future Enhancements" section that shows the thinking.

---

## 13. Testing Strategy

### Manual Testing Checklist
- [ ] `cdk deploy` succeeds
- [ ] API Gateway CORS works
- [ ] POST /projects creates project
- [ ] POST /projects/{id}/run starts execution
- [ ] All 6 agents complete successfully
- [ ] Security Agent runs bandit and integrates findings
- [ ] **Feedback loop:** CHANGES_REQUESTED loops back, APPROVED proceeds
- [ ] Documentation Agent produces README after loop converges
- [ ] **Level 1 validation:** Code Gen manifest includes validation results, all Python files pass `ast.parse()`
- [ ] Frontend loads, creates project, shows pipeline progress
- [ ] Frontend shows feedback loop iteration indicators
- [ ] Artifact viewer works with iteration selector
- [ ] Full end-to-end with Project 6 user stories

---

## 13a. Output Validation Tiers

The system validates generated code at three progressively deeper levels. Level 1 is mandatory and built into the core pipeline. Levels 2 and 3 are stretch goals with explicit gate criteria — do NOT start a higher level unless all gate conditions are met.

### Level 1: Syntax Validation (MANDATORY — built into Code Gen Agent)

**What:** Every generated Python file is passed through `ast.parse()` immediately after generation. Results are included in the Code Gen manifest. The Code Review agent sees validation errors and factors them into its verdict and feedback.

**Implementation:** Already specified in the Code Generation Agent handler (Section 6). No separate agent or infrastructure needed.

**What it proves:** The generated code is syntactically valid Python. This is the minimum bar for credibility — it proves the output is not garbled text or malformed code blocks.

**Behavior on failure:** Validation errors do NOT cause the Code Gen agent to fail. They are recorded in the manifest and surfaced to the Code Review agent, which should flag them as P1 issues and return CHANGES_REQUESTED. The feedback loop then triggers Code Gen to fix the syntax errors on the next iteration. This is intentional — it demonstrates the self-correcting nature of the pipeline.

---

### Level 2: Dependency Resolution Check (STRETCH GOAL)

**What:** After code generation, parse all `import` statements from the generated Python files and cross-reference them against the `requirements.txt` or `pyproject.toml` that the Code Gen agent also produces. Flag any import that references a third-party package not listed in the dependency file, and any listed dependency not actually imported anywhere.

**Implementation:** Add a validation function in the Code Gen agent handler (after Level 1 validation). Use `ast` module to walk the AST and extract all `Import` and `ImportFrom` nodes. Compare module names against Python stdlib (use `sys.stdlib_module_names` on Python 3.10+) and the generated requirements file. Add results to the manifest under `validation.dependency_check`.

**What it proves:** The generated project's dependency declarations are consistent with its actual imports. This catches a common LLM code generation failure mode where the model imports a library but forgets to list it as a dependency (or vice versa).

### Level 2 Gate Criteria — proceed ONLY if ALL are true:

- [ ] Phase 5 (frontend) is complete and the full user flow works
- [ ] The full pipeline runs end-to-end without errors for at least 2 consecutive runs
- [ ] You have **2+ hours** of build time remaining
- [ ] The feedback loop has been demonstrated working (Code Review triggers re-generation at least once)

**If any gate condition is not met:** Skip Level 2. Add it to the "Future Enhancements" section of the README. It is more important to have a polished, working demo than to have deeper validation on a fragile pipeline.

---

### Level 3: Test Execution (STRETCH GOAL)

**What:** A new **Test Execution Agent** (Agent 7) that actually runs the generated test suite against the generated code inside a Lambda function. It writes generated source files and test files to Lambda's `/tmp` directory, installs dependencies via `pip install --target /tmp/packages`, sets `PYTHONPATH`, and runs `pytest` as a subprocess. The output includes pass/fail counts, failure details, and coverage data. This output is then fed to the Code Review agent as additional context.

**Implementation:**
- New Lambda function: `test_execution_agent/`
- Memory: 1024 MB (needs headroom for pip install + pytest execution)
- Timeout: 5 minutes
- Ephemeral storage: 1024 MB (request via CDK `ephemeralStorageSize`)
- Handler logic:
  1. Fetch generated code files and test files from S3
  2. Write all files to `/tmp/project/`
  3. Run `pip install --target /tmp/packages -r /tmp/project/requirements.txt`
  4. Set `PYTHONPATH=/tmp/packages:/tmp/project`
  5. Run `pytest /tmp/project/tests/ --tb=short -q --json-report` as subprocess
  6. Parse results, write report to S3
  7. Return AgentOutput with pass/fail summary
- Pipeline placement: Runs AFTER Test Generation, BEFORE Code Review. So the pipeline becomes: Requirements → Code Gen → (Test Gen || Security) → Test Execution → Code Review → (loop?) → Documentation
- Code Review prompt update: Include test execution results in the review context. Test failures should be P1 issues that trigger CHANGES_REQUESTED.

**What it proves:** The generated code actually works. Tests written by one agent pass against code written by another agent. This is the strongest possible demonstration of multi-agent coordination quality.

### Level 3 Gate Criteria — proceed ONLY if ALL are true:

- [ ] Level 2 is implemented and working
- [ ] You have **1.5+ hours** of build time remaining
- [ ] **Spike test passes:** Before committing to Level 3, spend 10 minutes on a throwaway Lambda testing whether you can `pip install` packages into `/tmp` and run `pytest` as a subprocess. If this spike fails (permission issues, timeout, disk space), abandon Level 3 immediately.
- [ ] Generated code from Level 1 is consistently passing syntax validation (if Code Gen produces unparseable Python regularly, fix the Code Gen prompt — that's higher priority than adding test execution)
- [ ] The generated `requirements.txt` lists real, installable packages (not hallucinated package names)

**If any gate condition is not met:** Do NOT build Level 3. Instead, add this to the README under "Future Enhancements" with the architecture description:

> **Test Execution Agent (planned):** A seventh agent that executes the generated test suite inside a sandboxed Lambda environment. This would validate that code produced by the Code Generation agent and tests produced by the Test Generation agent are mutually consistent. The architecture would use Lambda's `/tmp` ephemeral storage with `pip install --target` for dependency isolation. Test results would feed into the Code Review agent's assessment, with test failures triggering the feedback loop for automatic remediation.

This demonstrates the thinking even if you didn't build it.

---

## 14. Demo Script (~5-7 min)

1. Open app URL. Brief UI tour.
2. **Explain concept** (30s): "6 AI agents, iterative feedback loop, tool-augmented security, aligned with Wipro WEGA."
3. **Create project** with Project 6 user stories. Start pipeline.
4. **Watch execution:** Requirements → Code Gen → (TestGen || Security) in parallel → Code Review → feedback loop → Code Gen (revised) → Documentation.
5. **Highlight key moments:** parallel execution, bandit-augmented security, CHANGES_REQUESTED verdict triggering revision, APPROVED on second pass.
6. **Walk through artifacts:** spec, code (toggle iterations to show what changed), tests, security report (bandit vs manual findings), review (scores + verdict progression), generated README.
7. **Meta-narrative:** "One system built another system — and it self-corrected along the way."
8. **Optional:** Show Step Functions console graph, CloudWatch logs.

---

## Appendix A: Environment Variables

| Variable | All Agents | API Only | Description |
|---|---|---|---|
| `ARTIFACTS_BUCKET` | ✓ | | S3 bucket name |
| `PROJECTS_TABLE` | ✓ | ✓ | DynamoDB table name |
| `BEDROCK_MODEL_ID` | ✓ | | `anthropic.claude-3-5-sonnet-20241022-v2:0` |
| `BEDROCK_REGION` | ✓ | | Region for Bedrock |
| `STATE_MACHINE_ARN` | | ✓ | Step Functions ARN |

## Appendix B: IAM Permissions

| Principal | Permissions | Resource |
|---|---|---|
| Agent Lambdas | bedrock:InvokeModel | foundation-model/anthropic.claude-* |
| Agent Lambdas | s3:PutObject, s3:GetObject | Artifacts bucket |
| Agent Lambdas | dynamodb:PutItem, GetItem, Query, UpdateItem | Projects table |
| API Lambdas | dynamodb:PutItem, GetItem, Query, UpdateItem | Projects table |
| API Lambdas | s3:GetObject | Artifacts bucket |
| API Lambdas | states:StartExecution, DescribeExecution | State machine |
| Step Functions | lambda:InvokeFunction | All 6 agent Lambdas |

## Appendix C: Cost Estimate

5-10 pipeline runs with feedback loops: **$2-5 total** (Bedrock ~$1-4, everything else < $0.50).

## Appendix D: Fallback Decisions

| Issue | Fallback |
|---|---|
| States.MathAdd not supported | Small Lambda to increment counter |
| Review always approves (no demo of loop) | Adjust prompt to be more critical, or add force_review_iteration flag |
| Review always requests changes | Max iteration check (< 2) guarantees termination |
| Bandit fails in Lambda | Fall back to pure LLM security analysis |
| Bedrock throttling | Use Haiku for testgen, documentation |
| CDK Docker bundling fails | Pre-build in deploy.sh (recommended approach) |
| Parallel branch indexing fragile | Make sequential: TestGen → Security. Lose ~30s, gain reliability |
| Large codebase exceeds context | Split Code Review into per-file calls, then synthesize |
