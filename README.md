# Archon SDLC

AI-powered multi-agent SDLC orchestrator that takes user stories and produces validated code, tests, security reports, and documentation — with a self-correcting feedback loop.

## How It Works

Six specialized AI agents run in a Step Functions pipeline:

```
Requirements → Code Gen → ┌─ Test Gen ─┐ → Code Review → Documentation
                           └─ Security ──┘
                                ↑              │
                                └──── Loop ────┘ (if CHANGES_REQUESTED)
```

1. **Requirements Agent** — Generates a detailed technical specification from user stories
2. **Code Gen Agent** — Produces a complete codebase from the spec (revises on feedback)
3. **Test Gen Agent** — Writes test suites for the generated code
4. **Security Agent** — Runs Bandit static analysis + AI-powered security review
5. **Code Review Agent** — Scores code across 7 dimensions, issues verdict (APPROVED / CHANGES_REQUESTED)
6. **Documentation Agent** — Generates README and API docs from all artifacts

The **feedback loop** is the key differentiator: if Code Review returns `CHANGES_REQUESTED`, the pipeline loops back to Code Gen with the review feedback, then re-runs tests + security. Up to 2 revision cycles.

## Architecture

Fully serverless on AWS:

- **Compute:** Lambda (Python 3.12) for all agents and API handlers
- **Orchestration:** Step Functions (Standard Workflow) with Choice state feedback loop
- **LLM:** Amazon Bedrock (Nova Premier, Nova Pro, Nova Lite, Mistral Devstral)
- **Storage:** DynamoDB (single-table design) + S3 (artifacts)
- **API:** API Gateway HTTP API (5 endpoints)
- **Frontend:** React + TypeScript + Tailwind + shadcn/ui on S3/CloudFront
- **Infrastructure:** CDK v2 (TypeScript)

### Per-Agent Model Assignments

| Agent | Model | Rationale |
|-------|-------|-----------|
| Requirements | Nova Premier | High-quality spec generation |
| Code Gen | Devstral 2 (123B) | Code-specialized model |
| Test Gen | Devstral 2 (123B) | Code-specialized model |
| Security | Nova Pro | Good analysis, cost-efficient |
| Code Review | Nova Premier | High-quality review judgments |
| Documentation | Nova Lite | Simple task, cheapest model |

## Prerequisites

- AWS CLI configured with credentials
- Node.js 18+
- Python 3.12+
- [uv](https://docs.astral.sh/uv/) package manager
- Bedrock model access enabled for Nova and Mistral models

## Deploy

```bash
bash deploy.sh
```

This single command:
1. Packages all 6 agent Lambdas with shared library
2. Packages API handler Lambdas
3. Builds the React frontend
4. Runs `cdk bootstrap` + `cdk deploy`
5. Rebuilds frontend with real API URL and redeploys

Outputs the CloudFront app URL and API Gateway URL.

## Usage

1. Open the app URL in a browser
2. Fill in project name, description, tech stack, and user stories
3. Click "Create & Start Pipeline"
4. Watch the pipeline dashboard as each agent runs
5. When complete, switch to the Artifacts tab to browse outputs

## Project Structure

```
archon-sdlc/
├── backend/
│   ├── agents/                  # 6 agent Lambdas
│   │   ├── requirements_agent/
│   │   ├── codegen_agent/
│   │   ├── testgen_agent/
│   │   ├── security_agent/
│   │   ├── codereview_agent/
│   │   └── documentation_agent/
│   ├── api/                     # 5 API handler Lambdas
│   └── shared/                  # Shared library (Bedrock, DynamoDB, S3, models)
├── frontend/                    # React + TypeScript + Vite
├── infrastructure/              # CDK v2 (TypeScript)
│   └── lib/constructs/
│       ├── pipeline.ts          # Step Functions + agent Lambdas
│       ├── api.ts               # API Gateway + handler Lambdas
│       ├── storage.ts           # DynamoDB + S3
│       └── frontend.ts          # S3 + CloudFront
├── docs/
│   ├── SPEC.md                  # Full technical specification
│   └── Issues.md                # Build/deploy issue catalog
└── deploy.sh                    # One-touch deployment
```

## Cleanup

```bash
cd infrastructure && npx cdk destroy
```
