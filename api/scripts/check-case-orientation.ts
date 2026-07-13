// Checks that each case's stored scramble (Cases table) leaves the U and D
// face centers unmoved (mod y rotations) - i.e. the case still ends up on
// top, not silently rotated onto another face by an unbalanced x/z or
// M/E/S turn. isSolved() wouldn't catch that itself since it only checks
// per-face uniformity, not which physical face ended up where.
//
// Usage: npm run check-orientation [setId]   (defaults to "OLL")
// Env vars: DYNAMODB_ENDPOINT (default http://localhost:8000), AWS_REGION
// (default us-east-1) - same as seed-algorithm-sets.ts.

import { readFileSync } from 'fs';
import { join } from 'path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { NormalCube } from '../cube/NormalCube';

const SET_ID = process.argv[2] ?? 'OLL';

type Face = 'top' | 'left' | 'front' | 'right' | 'back' | 'bottom';

// grid is private on NormalCube - reaching past that here only to read a
// center cell for this diagnostic; app code should never need to.
function centerColor(cube: NormalCube, face: Face): string {
    const { size } = cube;
    const half = Math.floor(size / 2);
    const coordsByFace: Record<Face, [number, number]> = {
        top: [size + half, half],
        front: [size + half, size + half],
        bottom: [size + half, size * 2 + half],
        left: [half, size + half],
        right: [size * 2 + half, size + half],
        back: [size * 3 + half, size + half],
    };
    const [x, y] = coordsByFace[face];
    return (cube as unknown as { grid: string[][] }).grid[x][y];
}

function buildDynamoClient(): DynamoDBDocumentClient {
    const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
    const isLocal = endpoint.includes('localhost') || endpoint.includes('127.0.0.1');
    const client = new DynamoDBClient({
        endpoint,
        region: process.env.AWS_REGION ?? 'us-east-1',
        ...(isLocal ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
    });
    return DynamoDBDocumentClient.from(client);
}

async function main(): Promise<void> {
    const docClient = buildDynamoClient();

    const result = await docClient.send(
        new QueryCommand({
            TableName: 'Cases',
            KeyConditionExpression: 'setId = :setId',
            ExpressionAttributeValues: { ':setId': SET_ID },
        }),
    );
    const cases = ((result.Items ?? []) as { caseId: number; scramble: string }[]).sort((a, b) => a.caseId - b.caseId);

    // Only used for readable failure output - the check itself only trusts
    // the DB's scramble, not this file.
    const { algorithms } = JSON.parse(readFileSync(join(__dirname, '..', '..', 'seed-data', `${SET_ID}.json`), 'utf-8')) as {
        algorithms: string[];
    };

    console.log(`Checking ${cases.length} "${SET_ID}" scrambles from DynamoDB...\n`);

    const failures: { caseId: number; scramble: string; algorithm: string; topColor: string; bottomColor: string }[] = [];

    for (const { caseId, scramble } of cases) {
        const cube = new NormalCube(3);
        cube.applyMoves(scramble);

        const topColor = centerColor(cube, 'top');
        const bottomColor = centerColor(cube, 'bottom');
        const ok = topColor === 'top' && bottomColor === 'bottom';

        console.log(`Case ${caseId}: ${ok ? 'OK' : 'FAIL'} (top="${topColor}", bottom="${bottomColor}") - scramble="${scramble}"`);
        if (!ok) {
            failures.push({ caseId, scramble, algorithm: algorithms[caseId - 1], topColor, bottomColor });
        }
    }

    console.log(`\n${cases.length - failures.length}/${cases.length} scrambles keep the case on the U (top) face.`);
    if (failures.length > 0) {
        console.log(`\n${failures.length} failure(s):`);
        for (const f of failures) {
            console.log(
                `  Case ${f.caseId}: top="${f.topColor}" bottom="${f.bottomColor}" - algorithm="${f.algorithm}" scramble="${f.scramble}"`,
            );
        }
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
