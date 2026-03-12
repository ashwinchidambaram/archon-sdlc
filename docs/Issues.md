# Issues Encountered During Build & Deployment

This document catalogs every issue hit during the Archon SDLC build and deployment process. Its purpose is to ensure one-touch deployment (`bash deploy.sh`) works reliably and to prevent regression.

---

## 1. Bedrock / Model Access Issues

### 1.1 Model ID requires inference profile format

- **Problem:** `ValidationException` when invoking Bedrock — raw model IDs like `anthropic.claude-3-5-sonnet-20241022-v2:0` are rejected.
- **Root Cause:** Bedrock requires inference profile IDs (`us.anthropic.claude-*` or `us.amazon.nova-*`) for on-demand invocation, not raw foundation model IDs. Nova models specifically require the `us.` prefix.
- **Fix:** Changed model IDs to inference profile format in both `bedrock.py` and `pipeline.ts`. (`fbf038e`, `7f527d1`)
- **Prevention:** Always use inference profile IDs. Check with `aws bedrock list-inference-profiles` for the correct format. Raw model IDs (without `us.` prefix) work for some providers (e.g., Mistral) but not Amazon Nova.

### 1.2 Claude 3.5 Sonnet v2 is legacy / not available

- **Problem:** `ResourceNotFoundException` — model `us.anthropic.claude-3-5-sonnet-20241022-v2:0` not found.
- **Root Cause:** Claude 3.5 Sonnet v2 was deprecated/legacy on Bedrock. Not available for new invocations.
- **Fix:** Switched to Claude Sonnet 4, then later to Haiku 4.5 for cost-efficient testing. (`4966067`, `c6595e4`)
- **Prevention:** Check model availability before hardcoding IDs: `aws bedrock get-foundation-model-availability --model-id <id>`.

### 1.3 Marketplace agreement not accepted

- **Problem:** `AccessDeniedException` — "You don't have access to the model with the specified model ID."
- **Root Cause:** AWS Bedrock now requires marketplace agreement acceptance per model via `aws bedrock create-foundation-model-agreement`.
- **Fix:** Created agreements via CLI for Haiku 4.5 and Sonnet 4.5.
- **Prevention:** Before deploying with a new model, run `aws bedrock get-foundation-model-availability --model-id <id>` and confirm `agreementAvailability.status` is `AVAILABLE`.

### 1.4 Invalid payment instrument blocks Anthropic models

- **Problem:** Marketplace agreements stuck in `ERROR` with `INVALID_PAYMENT_INSTRUMENT` despite adding a payment method.
- **Root Cause:** AWS Marketplace requires a valid payment instrument linked to the account. Payment method propagation can take up to 24 hours.
- **Fix:** Switched to non-Anthropic models (Amazon Nova, Mistral Devstral) that don't require marketplace agreements. Migrated `bedrock.py` from Anthropic-specific `invoke_model` to model-agnostic Converse API. (`0299515`, `df33e2b`)
- **Prevention:** Use the Bedrock Converse API (model-agnostic) so switching models only requires changing an env var. Amazon first-party models (Nova) have no marketplace agreement requirement.

### 1.5 Anthropic-specific request body format

- **Problem:** The original `bedrock.py` used `anthropic_version` and Anthropic-specific JSON body format in `client.invoke_model()`, which only works with Anthropic models.
- **Root Cause:** Tight coupling to one provider's API format.
- **Fix:** Rewrote to use `client.converse()` (Bedrock Converse API) which accepts all model providers with a single request/response format. (`0299515`)
- **Prevention:** Always use the Converse API for model invocations — it's provider-agnostic.

---

## 2. IAM / Permissions Issues

### 2.1 IAM policy region-locked breaks inference profiles

- **Problem:** `AccessDeniedException` when invoking models via inference profiles.
- **Root Cause:** IAM policy used `arn:aws:bedrock:${REGION}::foundation-model/...` but inference profiles route requests cross-region, so the region in the ARN must be wildcarded.
- **Fix:** Changed to `arn:aws:bedrock:*::foundation-model/*` and added `arn:aws:bedrock:${REGION}:${ACCOUNT_ID}:inference-profile/us.*`. (`b89d45b`, `df33e2b`)
- **Prevention:** Use wildcard region (`*`) in foundation model ARNs. Inference profile ARNs need the specific region and account.

---

## 3. CDK / Infrastructure Issues

### 3.1 CDK asset hash caching prevents Lambda code updates

- **Problem:** `cdk deploy` reports "no changes" even though Lambda handler code was modified.
- **Root Cause:** CDK uses content-based asset hashing. If the `package/` directory content hasn't changed from CDK's perspective (e.g., `deploy.sh` repackages but CDK compares against previously deployed hash), it skips the update.
- **Fix:** Clear `cdk.out` before deploying: `rm -rf infrastructure/cdk.out && npx cdk deploy`.
- **Prevention:** `deploy.sh` should always repackage Lambdas before running `cdk deploy`. If CDK still shows "no changes", delete `cdk.out`.

### 3.2 CDK env var overrides Python default

- **Problem:** Changed `DEFAULT_MODEL_ID` in `bedrock.py` but Lambdas still used the old model.
- **Root Cause:** `pipeline.ts` sets `BEDROCK_MODEL_ID` as a Lambda environment variable, which overrides the Python-level `DEFAULT_MODEL_ID`. Both must be updated together.
- **Fix:** Updated both `bedrock.py:15` and `pipeline.ts:23` simultaneously. Now pipeline.ts sets per-agent model IDs.
- **Prevention:** Model IDs are now configured per-agent in `pipeline.ts` only. `bedrock.py` default is a fallback that should rarely matter.

### 3.3 Lambda timeout too short for large models

- **Problem:** CodeGen Lambda timed out at 300 seconds (5 min) when using Devstral 2 (123B parameter model).
- **Root Cause:** Default Lambda timeout of 5 minutes insufficient for large model inference.
- **Fix:** Increased Lambda timeout to 10 minutes in `pipeline.ts`. (`df33e2b`)
- **Prevention:** Set generous Lambda timeouts (10 min) when using large models. The Step Functions state machine has its own 1-hour timeout as a safety net.

### 3.4 Boto3 read timeout for Bedrock requests

- **Problem:** `ReadTimeoutError` on Bedrock endpoint when invoking Devstral 2 — the HTTP read timed out before the model finished generating.
- **Root Cause:** Default boto3 read timeout (~60s) is too short for large models generating lengthy code responses.
- **Fix:** Set `Config(read_timeout=600, connect_timeout=10)` on the Bedrock Runtime client. (`0299515`)
- **Prevention:** Always configure extended read timeouts for Bedrock clients, especially when using large models.

---

## 4. Lambda Runtime Issues

### 4.1 DynamoDB rejects Python float type

- **Problem:** `TypeError: Float types are not supported. Use Decimal types instead` when writing stage results.
- **Root Cause:** DynamoDB's boto3 resource interface requires `Decimal` for numeric types, not Python `float`. Model response metadata includes floats (e.g., `duration_seconds`).
- **Fix:** Added `_sanitize_floats()` helper in `dynamodb.py` that recursively converts floats to `Decimal(str(f))`. Called before `table.put_item()`. (`9845248`)
- **Prevention:** The helper is applied to all items before writing. No action needed.

### 4.2 `parse_json_response` crashes on malformed code fence

- **Problem:** `ValueError` when model response starts with `` ``` `` but has no newline after the fence.
- **Root Cause:** Used `text.index("\n")` which throws on missing newline.
- **Fix:** Changed to `text.find("\n")` with fallback handling for the -1 case. (`d934509`)
- **Prevention:** Fixed in code. The function now handles all fence variations.

### 4.3 Non-Claude models produce invalid JSON responses

- **Problem:** `json.JSONDecodeError` — "Extra data" or "Invalid control character" when parsing responses from Nova and Mistral models.
- **Root Cause:** Non-Claude models sometimes: (a) add preamble text before JSON, (b) include control characters in string values, (c) append explanatory text after the JSON object.
- **Fix:** Enhanced `parse_json_response` to: strip control characters via regex, try direct parse first, then fall back to extracting the first `{...}` block. (`0299515`)
- **Prevention:** The robust parser handles these cases automatically. If a new model produces a different format, check CloudWatch logs for the raw response.

### 4.4 Error path in `write_stage_result` masks original error

- **Problem:** When an agent failed, the `write_stage_result()` call in the `except` block could itself throw (e.g., DynamoDB error), masking the original agent error.
- **Root Cause:** No try/except around the DynamoDB write in the error handler.
- **Fix:** Wrapped `write_stage_result` in try/except in all 6 agent handlers. (`d5f4157`)
- **Prevention:** All agent handlers now have this pattern. Follow it for any new agents.

### 4.5 Requirements agent missing `s3_key` in error return

- **Problem:** Step Functions failed because the requirements agent's error response didn't include `s3_key`, which the `resultSelector` expected.
- **Root Cause:** Error path returned incomplete payload.
- **Fix:** Full error path rewrite in requirements handler to include all expected fields. (`e6361cf`)
- **Prevention:** All agent error paths now return the complete set of fields that the Step Functions `resultSelector` expects.

---

## 5. Code Review Fixes (P1/P2 from automated review)

### 5.1 Error handling hardening across all agents

- **Problem:** P1 — Unhandled exceptions in agent error paths could crash Lambdas without recording failure state.
- **Fix:** Added comprehensive try/except with DynamoDB failure recording in all 6 handlers. (`d5f4157`, `e6361cf`)

### 5.2 `parse_json_response` edge case

- **Problem:** P1 — Code fence without newline causes crash.
- **Fix:** Defensive parsing with `find()` instead of `index()`. (`d934509`)

### 5.3 Bedrock max tokens too low

- **Problem:** P2 — Default max tokens was insufficient for code generation responses.
- **Fix:** Bumped to 8192 default, 16384 for codegen/testgen agents. (`af493b4`)

---

## 6. API Handler Issues

### 6.1 Pydantic C extension not cross-platform compatible

- **Problem:** `Runtime.ImportModuleError: No module named 'pydantic_core._pydantic_core'` in API handler Lambdas.
- **Root Cause:** `uv pip install --target` packages the shared library (which includes Pydantic) using the host machine's platform (macOS ARM64). Lambda runs on Linux ARM64. The `pydantic_core` C extension is compiled for the wrong platform.
- **Fix:** Removed Pydantic imports from API handlers. Validate request bodies with plain dict/isinstance checks instead. Agent Lambdas work because they never directly import Pydantic models.
- **Prevention:** Don't import Pydantic in API handlers. The shared library can use Pydantic internally only if agents are the consumers (they're packaged differently). For cross-platform compatibility, use `--platform manylinux2014_aarch64` with uv pip install.

### 6.2 DynamoDB stage results missing stage name and iteration

- **Problem:** Frontend couldn't determine which stage each result belonged to — `get_all_stages()` stripped the sort key without parsing stage/iteration from it.
- **Root Cause:** `dynamodb.py:get_all_stages()` stripped `pk` and `sk` from items but didn't extract `stage` and `iteration` from the sk format (`STAGE#codegen#iter0`).
- **Fix:** Added `_parse_stage_sk()` helper to extract stage name and iteration number from the sort key before stripping it. Each item now includes `stage` and `iteration` fields.
- **Prevention:** When stripping composite keys from DynamoDB items, always extract meaningful fields first.

### 6.3 IAM policy for DescribeExecution requires execution ARN

- **Problem:** `AccessDeniedException` when calling `states:DescribeExecution` — the IAM policy only allowed the state machine ARN.
- **Root Cause:** `DescribeExecution` requires the execution ARN (`arn:aws:states:region:account:execution:name:id`), not the state machine ARN (`arn:aws:states:region:account:stateMachine:name`). CDK token-based string replace (`stateMachineArn.replace(':stateMachine:', ':execution:')`) doesn't work because CDK tokens aren't resolved at synth time.
- **Fix:** Used explicit ARN format: `` `arn:aws:states:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:execution:sdlc-pipeline:*` ``.
- **Prevention:** Always construct execution ARNs explicitly with `cdk.Aws` pseudo-parameters. Don't manipulate CDK token strings with JavaScript string methods.

---

## 7. Deploy Script Issues

### 7.1 No issues with `deploy.sh` itself

The deploy script (`deploy.sh`) has worked reliably throughout. It correctly:
- Packages all 6 agent Lambdas with shared library
- Packages API handler stubs
- Builds frontend with placeholder or real API URL
- Runs `cdk bootstrap` + `cdk deploy`

The only caveat is CDK asset caching (see 3.1) — if `cdk deploy` says "no changes" when you expect changes, delete `infrastructure/cdk.out` and retry.
