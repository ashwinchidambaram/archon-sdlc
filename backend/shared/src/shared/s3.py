import json
import logging
import os

import boto3

logger = logging.getLogger(__name__)


def get_s3_client():
    return boto3.client("s3")


def write_artifact(s3_key: str, content: str, content_type: str = "application/json") -> str:
    bucket = os.environ["ARTIFACTS_BUCKET"]
    client = get_s3_client()
    client.put_object(
        Bucket=bucket,
        Key=s3_key,
        Body=content.encode("utf-8"),
        ContentType=content_type,
    )
    logger.info("wrote artifact s3://%s/%s", bucket, s3_key)
    return s3_key


def read_artifact(s3_key: str) -> str:
    bucket = os.environ["ARTIFACTS_BUCKET"]
    client = get_s3_client()
    response = client.get_object(Bucket=bucket, Key=s3_key)
    content = response["Body"].read().decode("utf-8")
    logger.info("read artifact s3://%s/%s", bucket, s3_key)
    return content


def write_json_artifact(s3_key: str, data: dict) -> str:
    return write_artifact(s3_key, json.dumps(data, indent=2))


def read_json_artifact(s3_key: str) -> dict:
    return json.loads(read_artifact(s3_key))


def write_files_artifact(s3_prefix: str, files: list[dict]) -> str:
    for file in files:
        key = f"{s3_prefix}/{file['path']}"
        write_artifact(key, file["content"], content_type="text/plain")

    manifest_key = f"{s3_prefix}/manifest.json"
    write_json_artifact(manifest_key, {"files": files})
    logger.info("wrote manifest with %d files to %s", len(files), manifest_key)
    return manifest_key
