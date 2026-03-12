import json
import logging
import os
import subprocess
import tempfile
import time
from datetime import datetime, timezone

from shared.bedrock import invoke_model, parse_json_response
from shared.dynamodb import write_stage_result
from shared.s3 import read_artifact, write_json_artifact
from prompt import SYSTEM_PROMPT

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

STAGE_NAME = "security"


def lambda_handler(event, context):
    start_iso = datetime.now(timezone.utc).isoformat()
    project_id = event.get("project_id", "unknown")
    execution_id = event.get("execution_id", "")
    iteration = event.get("iteration", 0)
    project_context = event.get("project_context", {})
    previous_stages = event.get("previous_stages", {})

    try:
        # 1. Fetch generated code manifest from S3
        codegen_stage = previous_stages.get("codegen", {})
        codegen_s3_key = codegen_stage.get("s3_key", "") if codegen_stage else ""
        manifest_content = read_artifact(codegen_s3_key) if codegen_s3_key else "{}"
        manifest = json.loads(manifest_content)
        files = manifest.get("files", [])

        # 2. Write code files to temp directory and run bandit
        bandit_findings = run_bandit(files)

        # 3. Format code and bandit results for Bedrock prompt
        code_summary = format_files_for_prompt(files)
        bandit_json = json.dumps(bandit_findings, indent=2)

        user_message = f"""## Source Code

{code_summary}

## Bandit Static Analysis Results

{bandit_json}

Analyze the code and bandit findings. Provide your security assessment as a JSON object following the output format specified in your instructions."""

        # 4. Call Bedrock for AI-powered security analysis
        response = invoke_model(SYSTEM_PROMPT, user_message, max_tokens=8192)

        # 5. Parse the security report
        report = parse_json_response(response["content"])

        # 6. Enrich report with bandit metadata
        bandit_count = len(bandit_findings.get("results", []))
        if "metadata" not in report:
            report["metadata"] = {}
        report["metadata"]["bandit_findings_count"] = bandit_count

        # 7. Write security report to S3
        s3_key = f"{project_id}/security/iter{iteration}/security-report.json"
        write_json_artifact(s3_key, report)

        summary_obj = report.get("summary", {})
        summary = (
            f"Security scan complete: {summary_obj.get('total_findings', 0)} findings "
            f"({summary_obj.get('critical', 0)} critical, {summary_obj.get('high', 0)} high, "
            f"{summary_obj.get('medium', 0)} medium, {summary_obj.get('low', 0)} low). "
            f"Overall risk: {summary_obj.get('overall_risk', 'UNKNOWN')}"
        )

        # 8. Write stage result to DynamoDB
        end_iso = datetime.now(timezone.utc).isoformat()
        write_stage_result(project_id, STAGE_NAME, iteration, {
            "status": "completed",
            "s3_key": s3_key,
            "summary": summary,
            "started_at": start_iso,
            "completed_at": end_iso,
            "metadata": {
                "model_id": response["model_id"],
                "input_tokens": response["input_tokens"],
                "output_tokens": response["output_tokens"],
                "duration_seconds": response["duration_seconds"],
                "bandit_findings_count": bandit_count,
            },
        })

        logger.info("security scan complete: %s", summary)

        # 9. Return AgentOutput
        return {
            "stage": STAGE_NAME,
            "status": "completed",
            "s3_key": s3_key,
            "summary": summary,
            "iteration": iteration,
            "metadata": {
                "model_id": response["model_id"],
                "input_tokens": response["input_tokens"],
                "output_tokens": response["output_tokens"],
                "duration_seconds": response["duration_seconds"],
            },
        }

    except Exception as e:
        logger.exception("security agent failed")
        end_iso = datetime.now(timezone.utc).isoformat()
        write_stage_result(project_id, STAGE_NAME, iteration, {
            "status": "failed",
            "s3_key": "",
            "summary": f"Error: {e}",
            "started_at": start_iso,
            "completed_at": end_iso,
        })
        return {
            "stage": STAGE_NAME,
            "status": "failed",
            "s3_key": "",
            "summary": f"Error: {e}",
            "iteration": iteration,
            "metadata": {
                "model_id": "unknown",
                "input_tokens": 0,
                "output_tokens": 0,
                "duration_seconds": 0,
            },
        }


def run_bandit(files):
    with tempfile.TemporaryDirectory() as tmpdir:
        python_files_written = 0
        for f in files:
            fpath = f.get("path", "")
            if not fpath.endswith(".py"):
                continue
            full_path = os.path.join(tmpdir, fpath)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            with open(full_path, "w") as fp:
                fp.write(f.get("content", ""))
            python_files_written += 1

        if python_files_written == 0:
            logger.info("no Python files to scan with bandit")
            return {"results": [], "metrics": {}, "errors": []}

        try:
            result = subprocess.run(
                ["python", "-m", "bandit", "-r", tmpdir, "-f", "json", "--severity-level", "low"],
                capture_output=True,
                text=True,
                timeout=60,
            )
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                logger.warning("bandit output not valid JSON: %s", result.stderr[:500])
                return {"results": [], "errors": [result.stderr[:500]]}
        except subprocess.TimeoutExpired:
            logger.error("bandit timed out after 60s")
            return {"results": [], "errors": ["bandit timed out after 60 seconds"]}
        except FileNotFoundError:
            logger.error("bandit not found in environment")
            return {"results": [], "errors": ["bandit not installed"]}


def format_files_for_prompt(files):
    parts = []
    for f in files:
        path = f.get("path", "unknown")
        content = f.get("content", "")
        parts.append(f"### {path}\n```python\n{content}\n```")
    return "\n\n".join(parts)
