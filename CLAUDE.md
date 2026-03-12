# CLAUDE.md

This project is **Archon SDLC** — an AI-powered multi-agent SDLC orchestrator built on AWS.

## Spec Document

The complete technical specification is at `docs/SPEC.md`. **Read it in full before starting any work.** It contains the architecture, all agent definitions, Step Functions state machine, CDK infrastructure, API design, frontend design, data models, and phased build plan. Do not deviate from the spec without explicit instruction.

## Build Instructions

Follow the phased development plan in Section 12 of the spec. Build phases sequentially. Deploy and test after each agent implementation — do not batch.

## Key Constraints

- Fully serverless on AWS (Lambda, Step Functions, API Gateway, DynamoDB, S3)
- CDK v2 in TypeScript for infrastructure
- Python 3.12 with uv for backend
- React + TypeScript + Vite + shadcn/ui for frontend
- Amazon Bedrock (Claude 3.5 Sonnet) for all LLM calls
- No Docker required — deploy.sh pre-builds Lambda packages

## Demo Data

Demo user stories for testing are at `docs/project6-user-stories.json`. These are used in Phase 6 for demo preparation, not during development.

## Git Workflow

**Commit after every phase milestone and after every working agent implementation.** Do not wait until the end to commit. The commit history should tell the story of the build.

### Commit Style Rules

Write commit messages that sound like a real engineer wrote them — casual, concise, lowercase-leaning, no corporate polish. Think "dev pushing code at 2am" not "AI-generated changelog entry."

**Good examples:**
- `scaffold project structure + shared models`
- `cdk stack deploys, all lambdas stubbed out`
- `requirements agent working, generates clean specs`
- `codegen agent with ast.parse validation, feedback loop wired`
- `security agent runs bandit + bedrock interpretation`
- `frontend polling works, pipeline dashboard looks solid`
- `fix: step functions parallel branch output indexing was wrong`
- `code review agent drives feedback loop correctly now`
- `docs agent, full pipeline end to end works`
- `cleanup, readme, deploy script tested from clean clone`

**Bad examples (DO NOT write commits like this):**
- `Implemented the Requirements Analysis Agent with comprehensive prompt engineering`
- `Added robust error handling and validation to the Code Generation pipeline`
- `Refactored infrastructure to improve modularity and maintainability`
- `Enhanced the frontend with real-time pipeline visualization capabilities`
- `feat: Implement Security Scanning Agent with Bandit integration and Bedrock-powered analysis`

**General rules:**
- Lowercase unless it's a proper noun or acronym (CDK, Lambda, S3, Bedrock)
- No periods at the end
- No conventional commits prefixes (no `feat:`, `chore:`, `refactor:`) unless it's a genuine fix, in which case `fix:` is fine
- Keep it under 60 characters when possible
- Be specific about what actually changed, not what it conceptually achieves
- It's fine to be blunt: `wip: testgen agent mostly works, needs prompt tuning`
- Use the imperative mood naturally — "add", "fix", "wire up", "get X working" — but don't force it
