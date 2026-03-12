#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# deploy.sh — one-touch deploy for Archon SDLC
# ============================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die()     { error "$*"; exit 1; }

# ============================================================
# 1. Prerequisites
# ============================================================
echo ""
info "Checking prerequisites..."

# aws CLI
if ! command -v aws &>/dev/null; then
  die "aws CLI not found. Install it from https://aws.amazon.com/cli/"
fi
ok "aws CLI found: $(aws --version 2>&1 | head -1)"

# node (v18+)
if ! command -v node &>/dev/null; then
  die "node not found. Install Node.js v18+ from https://nodejs.org/"
fi
NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "node v$NODE_VERSION is too old. Requires v18+."
fi
ok "node found: v$NODE_VERSION"

# python3 (3.12+)
if ! command -v python3 &>/dev/null; then
  die "python3 not found. Install Python 3.12+ from https://www.python.org/"
fi
PY_VERSION=$(python3 --version | awk '{print $2}')
PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 12 ]; }; then
  die "python3 $PY_VERSION is too old. Requires 3.12+."
fi
ok "python3 found: $PY_VERSION"

# uv
if ! command -v uv &>/dev/null; then
  die "uv not found. Install it with: curl -Lsf https://astral.sh/uv/install.sh | sh"
fi
ok "uv found: $(uv --version)"

# AWS credentials
info "Verifying AWS credentials..."
CALLER_IDENTITY=$(aws sts get-caller-identity 2>&1) || die "AWS credentials not configured or invalid.\n$CALLER_IDENTITY"
AWS_ACCOUNT=$(echo "$CALLER_IDENTITY" | python3 -c "import sys,json; print(json.load(sys.stdin)['Account'])")
AWS_ARN=$(echo "$CALLER_IDENTITY" | python3 -c "import sys,json; print(json.load(sys.stdin)['Arn'])")
ok "AWS credentials valid — account: $AWS_ACCOUNT, identity: $AWS_ARN"

# ============================================================
# 2. Package backend Lambda functions
# ============================================================
echo ""
info "Packaging backend Lambda functions..."

BACKEND_DIR="$ROOT_DIR/backend"

if [ ! -d "$BACKEND_DIR" ]; then
  warn "backend/ directory not found — skipping Lambda packaging"
else
  # Package each agent
  if [ -d "$BACKEND_DIR/agents" ]; then
    for agent_dir in "$BACKEND_DIR/agents"/*/; do
      [ -d "$agent_dir" ] || continue
      agent_name=$(basename "$agent_dir")
      info "Packaging agent: $agent_name"

      rm -rf "$agent_dir/package"
      mkdir -p "$agent_dir/package"

      # Install shared library
      if [ -d "$BACKEND_DIR/shared" ]; then
        uv pip install --target "$agent_dir/package" "$BACKEND_DIR/shared/" --quiet 2>&1 || \
          warn "shared lib install had warnings for $agent_name"
      fi

      # Install agent-specific deps (no-deps to avoid duplicating shared)
      if [ -f "$agent_dir/pyproject.toml" ]; then
        uv pip install --target "$agent_dir/package" --no-deps "$agent_dir" --quiet 2>&1 || true
      fi

      # Copy handler and prompt into package root
      if [ -f "$agent_dir/handler.py" ]; then
        cp "$agent_dir/handler.py" "$agent_dir/package/"
      else
        warn "No handler.py found in $agent_name — skipping copy"
      fi
      if [ -f "$agent_dir/prompt.py" ]; then
        cp "$agent_dir/prompt.py" "$agent_dir/package/"
      fi

      ok "Packaged $agent_name"
    done
  else
    warn "backend/agents/ not found — skipping agent packaging"
  fi

  # Package API handlers
  if [ -d "$BACKEND_DIR/api" ]; then
    info "Packaging API handlers..."
    rm -rf "$BACKEND_DIR/api/package"
    mkdir -p "$BACKEND_DIR/api/package"

    if [ -d "$BACKEND_DIR/shared" ]; then
      uv pip install --target "$BACKEND_DIR/api/package" "$BACKEND_DIR/shared/" --quiet 2>&1 || \
        warn "shared lib install had warnings for api handlers"
    fi

    for f in "$BACKEND_DIR/api/"*.py; do
      [ -f "$f" ] || continue
      cp "$f" "$BACKEND_DIR/api/package/"
    done

    ok "Packaged API handlers"
  else
    warn "backend/api/ not found — skipping API handler packaging"
  fi
fi

# ============================================================
# 3. Build frontend (initial pass — may use placeholder API URL)
# ============================================================
echo ""
info "Building frontend..."

FRONTEND_DIR="$ROOT_DIR/frontend"

if [ ! -d "$FRONTEND_DIR" ]; then
  warn "frontend/ directory not found — skipping frontend build"
  FRONTEND_BUILT=false
else
  cd "$FRONTEND_DIR"
  npm ci --silent

  # Attempt to fetch existing API URL from deployed stack
  API_URL=$(aws cloudformation describe-stacks \
    --stack-name SdlcOrchestratorStack \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
    --output text 2>/dev/null || echo "")

  if [ -z "$API_URL" ]; then
    warn "Stack not yet deployed — building frontend with placeholder API URL"
    echo "VITE_API_URL=http://localhost:3000" > .env
  else
    info "Using existing API URL: $API_URL"
    echo "VITE_API_URL=$API_URL" > .env
  fi

  npm run build --silent
  cd "$ROOT_DIR"
  ok "Frontend built"
  FRONTEND_BUILT=true
fi

# ============================================================
# 4. Deploy CDK infrastructure
# ============================================================
echo ""
info "Deploying CDK infrastructure..."

INFRA_DIR="$ROOT_DIR/infrastructure"

if [ ! -d "$INFRA_DIR" ]; then
  die "infrastructure/ directory not found. Cannot deploy."
fi

cd "$INFRA_DIR"
npm ci --silent

info "Bootstrapping CDK (idempotent)..."
npx cdk bootstrap --quiet 2>&1 | grep -v "^$" || true

info "Deploying stack..."
npx cdk deploy --require-approval never --outputs-file outputs.json

cd "$ROOT_DIR"
ok "CDK deployment complete"

# ============================================================
# 5. Post-deploy: rebuild frontend with real API URL (if needed)
# ============================================================
OUTPUTS_FILE="$INFRA_DIR/outputs.json"

if [ "$FRONTEND_BUILT" = true ] && [ -f "$OUTPUTS_FILE" ]; then
  REAL_API_URL=$(python3 -c \
    "import sys,json; d=json.load(open('$OUTPUTS_FILE')); print(d.get('SdlcOrchestratorStack',{}).get('ApiUrl',''))" \
    2>/dev/null || echo "")

  if [ -n "$REAL_API_URL" ]; then
    CURRENT_ENV=""
    [ -f "$FRONTEND_DIR/.env" ] && CURRENT_ENV=$(cat "$FRONTEND_DIR/.env")

    if [ "$CURRENT_ENV" != "VITE_API_URL=$REAL_API_URL" ]; then
      info "Rebuilding frontend with real API URL: $REAL_API_URL"
      cd "$FRONTEND_DIR"
      echo "VITE_API_URL=$REAL_API_URL" > .env
      npm run build --silent
      cd "$ROOT_DIR"

      info "Redeploying stack to sync frontend assets..."
      cd "$INFRA_DIR"
      npx cdk deploy --require-approval never --outputs-file outputs.json
      cd "$ROOT_DIR"
      ok "Frontend rebuilt and redeployed with real API URL"
    else
      info "Frontend already built with correct API URL — no rebuild needed"
    fi
  else
    warn "Could not extract ApiUrl from outputs.json — frontend may need a manual rebuild"
  fi
fi

# ============================================================
# 6. Print outputs
# ============================================================
echo ""
echo "========================================"
echo "  Deployment Complete"
echo "========================================"

if [ -f "$OUTPUTS_FILE" ]; then
  APP_URL=$(python3 -c \
    "import sys,json; d=json.load(open('$OUTPUTS_FILE')); print(d.get('SdlcOrchestratorStack',{}).get('AppUrl',''))" \
    2>/dev/null || echo "")
  API_URL=$(python3 -c \
    "import sys,json; d=json.load(open('$OUTPUTS_FILE')); print(d.get('SdlcOrchestratorStack',{}).get('ApiUrl',''))" \
    2>/dev/null || echo "")

  if [ -n "$APP_URL" ]; then
    echo -e "  App URL : ${GREEN}$APP_URL${NC}"
  else
    echo "  App URL : Check CloudFormation outputs"
  fi

  if [ -n "$API_URL" ]; then
    echo -e "  API URL : ${GREEN}$API_URL${NC}"
  else
    echo "  API URL : Check CloudFormation outputs"
  fi
else
  echo "  Check CloudFormation outputs in the AWS console"
fi

echo "========================================"
echo ""
