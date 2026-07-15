// Wipes every item from the Algorithms and Votes tables (AlgorithmSets and
// Cases are untouched - they're set/case metadata, not user data), then
// re-runs the seed script so each case is left with its one default
// algorithm at 0 votes, same as a fresh deploy.
//
// Usage: npm run reset
// Env vars: DYNAMODB_ENDPOINT (unset -> talks to real AWS DynamoDB using
// your AWS CLI credentials; set to http://localhost:8000 for local dev
// against DynamoDB Local), AWS_REGION (default us-east-1).

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { execFileSync } from 'child_process';

const TABLES_TO_WIPE: Record<string, string[]> = {
    Algorithms: ['setIdCaseId', 'algorithmId'],
    Votes: ['installationId', 'setIdCaseId'],
};

function buildDynamoClient(): DynamoDBDocumentClient {
    const endpoint = process.env.DYNAMODB_ENDPOINT;
    const client = new DynamoDBClient({
        region: process.env.AWS_REGION ?? 'us-east-1',
        ...(endpoint
            ? {
                  endpoint,
                  // DynamoDB Local ignores these entirely, but the SDK still
                  // requires *something* to be set before it will issue a request.
                  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
              }
            : {}),
    });
    return DynamoDBDocumentClient.from(client);
}

async function wipeTable(tableName: string, keyAttrs: string[], docClient: DynamoDBDocumentClient): Promise<void> {
    let exclusiveStartKey: Record<string, unknown> | undefined;
    let deleted = 0;

    do {
        const scanResult = await docClient.send(
            new ScanCommand({
                TableName: tableName,
                ProjectionExpression: keyAttrs.join(', '),
                ExclusiveStartKey: exclusiveStartKey,
            }),
        );
        const items = scanResult.Items ?? [];

        // BatchWriteItem caps out at 25 requests per call.
        for (let i = 0; i < items.length; i += 25) {
            const batch = items.slice(i, i + 25);
            await docClient.send(
                new BatchWriteCommand({
                    RequestItems: {
                        [tableName]: batch.map((item) => ({
                            DeleteRequest: {
                                Key: Object.fromEntries(keyAttrs.map((attr) => [attr, item[attr]])),
                            },
                        })),
                    },
                }),
            );
        }

        deleted += items.length;
        exclusiveStartKey = scanResult.LastEvaluatedKey;
    } while (exclusiveStartKey);

    console.log(`Deleted ${deleted} item(s) from ${tableName}.`);
}

async function main(): Promise<void> {
    const docClient = buildDynamoClient();

    for (const [tableName, keyAttrs] of Object.entries(TABLES_TO_WIPE)) {
        await wipeTable(tableName, keyAttrs, docClient);
    }

    console.log('\nRe-seeding default algorithms from seed-data/...');
    execFileSync('npm', ['run', 'seed'], { stdio: 'inherit', env: process.env });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
