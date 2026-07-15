// Seeds every algorithm set (AlgorithmSets + Cases + Algorithms tables) from
// the seed-data/ folder: one <SETID>.json file per set, each shaped
// { cubeType, mask, algorithms }, where mask is
// NormalCube.applyIgnoreMask()'s string (which cells this set doesn't care
// about - see AlgorithmSetsTable in template.yaml) and algorithms is one
// *solving* algorithm per case, in case order (case 1 first). The set's ID
// is taken from the file name (e.g. seed-data/OLL.json -> setId "OLL").
//
// Usage: npm run seed
// Env vars: DYNAMODB_ENDPOINT (unset -> talks to real AWS DynamoDB using
// your AWS CLI credentials; set to http://localhost:8000 for local dev
// against DynamoDB Local), AWS_REGION (default us-east-1).

import { readdirSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { cleanNotation, invertNotation } from '../cube/notation';

const SEED_DATA_DIR = join(__dirname, '..', '..', 'seed-data');

interface AlgorithmSetSeedData {
    cubeType: string;
    mask: string;
    algorithms: string[];
}

function readSeedData(filePath: string): AlgorithmSetSeedData {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
}

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

async function seedAlgorithmSet(setId: string, filePath: string, docClient: DynamoDBDocumentClient): Promise<void> {
    const { cubeType, mask, algorithms } = readSeedData(filePath);
    console.log(`Read ${algorithms.length} algorithms from ${filePath}`);

    await docClient.send(
        new PutCommand({
            TableName: 'AlgorithmSets',
            Item: { setId, cubeType, mask },
        }),
    );
    console.log(`Seeded AlgorithmSets row for ${setId}`);

    for (const [index, rawAlgorithm] of algorithms.entries()) {
        const caseId = index + 1;
        const displayAlg = cleanNotation(rawAlgorithm);
        const invertedAlg = invertNotation(rawAlgorithm);

        await docClient.send(
            new PutCommand({
                TableName: 'Cases',
                Item: { setId, caseId, scramble: invertedAlg },
            }),
        );

        await docClient.send(
            new PutCommand({
                TableName: 'Algorithms',
                Item: {
                    setIdCaseId: `${setId}#${caseId}`,
                    // Deterministic, not random - re-running this script
                    // overwrites the same seeded default instead of piling
                    // up duplicates.
                    algorithmId: `${setId}-${caseId}-default`,
                    notation: displayAlg,
                    votes: 0,
                    createdAt: new Date().toISOString(),
                },
            }),
        );

        console.log(`Case ${caseId}: scramble="${invertedAlg}" default="${displayAlg}"`);
    }

    console.log(`Done: seeded ${algorithms.length} cases for ${setId}.`);
}

async function main(): Promise<void> {
    const files = readdirSync(SEED_DATA_DIR).filter((file) => file.endsWith('.json'));
    if (files.length === 0) {
        console.error(`No .json files found in ${SEED_DATA_DIR}`);
        process.exit(1);
    }

    const docClient = buildDynamoClient();

    for (const file of files) {
        const setId = basename(file, '.json');
        await seedAlgorithmSet(setId, join(SEED_DATA_DIR, file), docClient);
    }

    console.log(`\nSeeded ${files.length} algorithm set(s): ${files.map((file) => basename(file, '.json')).join(', ')}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
