#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# cleanup.sh — tear down all Archon SDLC AWS resources
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
# 1. Confirm destructive action
# ============================================================
echo ""
warn "This will DELETE all Archon SDLC resources from your AWS account:"
echo "  - CloudFront distribution"
echo "  - S3 buckets (frontend assets + pipeline artifacts)"
echo "  - API Gateway + Lambda functions (6 agents + 5 API handlers)"
echo "  - Step Functions state machine"
echo "  - DynamoDB table (all project data)"
echo "  - Cognito User Pool (all user accounts)"
echo ""
read -p "Are you sure? Type 'yes' to confirm: " CONFIRM
[[ "$CONFIRM" == "yes" ]] || die "Aborted."

# ============================================================
# 2. Verify AWS credentials
# ============================================================
info "Verifying AWS credentials..."
aws sts get-caller-identity &>/dev/null || die "AWS credentials not configured or invalid."
ok "AWS credentials valid"

# ============================================================
# 3. Destroy CDK stack
# ============================================================
INFRA_DIR="$ROOT_DIR/infrastructure"

if [ ! -d "$INFRA_DIR" ]; then
  die "infrastructure/ directory not found. Cannot destroy stack."
fi

info "Destroying CDK stack (SdlcOrchestratorStack)..."
cd "$INFRA_DIR"
npm ci --silent 2>/dev/null || true
npx cdk destroy --force
cd "$ROOT_DIR"
ok "Stack destroyed — all AWS resources removed"

# ============================================================
# 4. Optionally remove CDK bootstrap stack
# ============================================================
echo ""
read -p "Also remove CDK bootstrap resources (CDKToolkit stack)? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  info "Removing CDK bootstrap stack..."

  # Empty the CDK staging bucket first (required before stack deletion)
  STAGING_BUCKET=$(aws cloudformation describe-stack-resources \
    --stack-name CDKToolkit \
    --query 'StackResources[?ResourceType==`AWS::S3::Bucket`].PhysicalResourceId' \
    --output text 2>/dev/null || echo "")

  if [ -n "$STAGING_BUCKET" ]; then
    info "Emptying CDK staging bucket: $STAGING_BUCKET"
    aws s3 rm "s3://$STAGING_BUCKET" --recursive --quiet || true
  fi

  aws cloudformation delete-stack --stack-name CDKToolkit
  info "Waiting for CDKToolkit stack deletion..."
  aws cloudformation wait stack-delete-complete --stack-name CDKToolkit
  ok "CDK bootstrap stack removed"
else
  info "Keeping CDK bootstrap resources"
fi

# ============================================================
# 5. Optionally clean up local build artifacts
# ============================================================
echo ""
read -p "Clean up local build artifacts (package/ dirs, frontend/dist)? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  rm -rf "$ROOT_DIR"/backend/agents/*/package
  rm -rf "$ROOT_DIR/backend/api/package"
  rm -rf "$ROOT_DIR/frontend/dist"
  rm -f "$ROOT_DIR/frontend/.env"
  rm -f "$ROOT_DIR/infrastructure/outputs.json"
  ok "Local build artifacts cleaned"
else
  info "Keeping local build artifacts"
fi

# ============================================================
# Done
# ============================================================
echo ""
echo "========================================"
echo "  Cleanup Complete"
echo "========================================"
echo ""
echo "  All Archon SDLC AWS resources have been removed."
echo "  To redeploy, run: bash deploy.sh"
echo ""
echo "========================================"
echo ""
