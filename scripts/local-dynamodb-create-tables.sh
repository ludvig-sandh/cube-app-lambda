#!/usr/bin/env bash
# Creates the AlgorithmSets/Cases/Algorithms/Votes tables against DynamoDB
# Local, mirroring the table definitions in template.yaml exactly (same
# names, keys, GSI) so local behavior matches what gets deployed. Safe to
# re-run - skips any table that already exists.
#
# Usage: ./scripts/local-dynamodb-create-tables.sh
# Requires: `docker compose up -d` already running dynamodb-local on :8000.

set -euo pipefail

ENDPOINT="http://localhost:8000"
# DynamoDB Local ignores these credentials/region entirely, but the AWS CLI
# still requires *something* to be set before it will issue a request.
export AWS_ACCESS_KEY_ID="local"
export AWS_SECRET_ACCESS_KEY="local"
export AWS_DEFAULT_REGION="us-east-1"

table_exists() {
    aws dynamodb describe-table --endpoint-url "$ENDPOINT" --table-name "$1" >/dev/null 2>&1
}

if table_exists AlgorithmSets; then
    echo "AlgorithmSets table already exists, skipping"
else
    aws dynamodb create-table \
        --endpoint-url "$ENDPOINT" \
        --table-name AlgorithmSets \
        --attribute-definitions \
            AttributeName=setId,AttributeType=S \
        --key-schema \
            AttributeName=setId,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST \
        >/dev/null
    echo "Created AlgorithmSets table"
fi

if table_exists Cases; then
    echo "Cases table already exists, skipping"
else
    aws dynamodb create-table \
        --endpoint-url "$ENDPOINT" \
        --table-name Cases \
        --attribute-definitions \
            AttributeName=setId,AttributeType=S \
            AttributeName=caseId,AttributeType=N \
        --key-schema \
            AttributeName=setId,KeyType=HASH \
            AttributeName=caseId,KeyType=RANGE \
        --billing-mode PAY_PER_REQUEST \
        >/dev/null
    echo "Created Cases table"
fi

if table_exists Algorithms; then
    echo "Algorithms table already exists, skipping"
else
    aws dynamodb create-table \
        --endpoint-url "$ENDPOINT" \
        --table-name Algorithms \
        --attribute-definitions \
            AttributeName=setIdCaseId,AttributeType=S \
            AttributeName=algorithmId,AttributeType=S \
            AttributeName=votes,AttributeType=N \
        --key-schema \
            AttributeName=setIdCaseId,KeyType=HASH \
            AttributeName=algorithmId,KeyType=RANGE \
        --global-secondary-indexes \
            '[{
                "IndexName": "ByCaseVotes",
                "KeySchema": [
                    {"AttributeName": "setIdCaseId", "KeyType": "HASH"},
                    {"AttributeName": "votes", "KeyType": "RANGE"}
                ],
                "Projection": {"ProjectionType": "ALL"}
            }]' \
        --billing-mode PAY_PER_REQUEST \
        >/dev/null
    echo "Created Algorithms table"
fi

if table_exists Votes; then
    echo "Votes table already exists, skipping"
else
    aws dynamodb create-table \
        --endpoint-url "$ENDPOINT" \
        --table-name Votes \
        --attribute-definitions \
            AttributeName=installationId,AttributeType=S \
            AttributeName=setIdCaseId,AttributeType=S \
        --key-schema \
            AttributeName=installationId,KeyType=HASH \
            AttributeName=setIdCaseId,KeyType=RANGE \
        --billing-mode PAY_PER_REQUEST \
        >/dev/null
    echo "Created Votes table"
fi
