import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { docClient } from './db';
import { NormalCube } from './cube/NormalCube';
import { normalizeNotation, findInvalidMove } from './cube/notation';

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */

const jsonResponse = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
    statusCode,
    body: JSON.stringify(body),
});

// { error, message } envelope required on every non-2xx response - see
// docs/cube-app-api-spec.md §5.
const errorResponse = (statusCode: number, error: string, message: string): APIGatewayProxyResult =>
    jsonResponse(statusCode, { error, message });

// "3x3" -> 3. Only 3x3 cubes are seeded today, but cubeType is stored per
// algorithm set precisely so other sizes need no schema/route changes.
function cubeSizeForType(cubeType: string): number {
    return parseInt(cubeType.split('x')[0], 10);
}

const MAX_NOTATION_LENGTH = 200;

// GET /algorithm-sets/{setId}/top-algorithms - see
// docs/cube-app-api-spec.md §4.1.
const getTopAlgorithms = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const setId = event.pathParameters?.setId;
    if (!setId) {
        return errorResponse(400, 'invalid_request', 'Missing or invalid setId path parameter.');
    }

    const algorithmSet = await docClient.send(
        new GetCommand({
            TableName: process.env.ALGORITHM_SETS_TABLE_NAME!,
            Key: { setId },
        }),
    );
    if (!algorithmSet.Item) {
        return errorResponse(404, 'not_found', `Unknown algorithm set "${setId}".`);
    }

    const cases = await docClient.send(
        new QueryCommand({
            TableName: process.env.CASES_TABLE_NAME!,
            KeyConditionExpression: 'setId = :setId',
            ExpressionAttributeValues: { ':setId': setId },
            ProjectionExpression: 'caseId',
        }),
    );
    const caseIds = (cases.Items ?? []).map((item) => item.caseId as number);

    // Fans out one Query per case (see docs/cube-app-api-spec.md §3) rather
    // than one big query, since Algorithms is partitioned by setId#caseId -
    // there's no single index that returns "top algorithm per case" across
    // a whole set in one call.
    const topAlgorithms = await Promise.all(
        caseIds.map(async (caseId) => {
            const result = await docClient.send(
                new QueryCommand({
                    TableName: process.env.ALGORITHMS_TABLE_NAME!,
                    IndexName: 'ByCaseVotes',
                    KeyConditionExpression: 'setIdCaseId = :setIdCaseId',
                    ExpressionAttributeValues: { ':setIdCaseId': `${setId}#${caseId}` },
                    ScanIndexForward: false,
                    Limit: 1,
                }),
            );
            const top = result.Items?.[0];
            return top ? { caseId, notation: top.notation as string } : null;
        }),
    );

    const body = topAlgorithms
        .filter((entry): entry is { caseId: number; notation: string } => entry !== null)
        .sort((a, b) => a.caseId - b.caseId);

    return jsonResponse(200, body);
};

// GET /algorithm-sets/{setId}/cases/{caseId}/algorithms - see
// docs/cube-app-api-spec.md §4.2.
const listAlgorithms = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const setId = event.pathParameters?.setId;
    const caseId = Number(event.pathParameters?.caseId);
    if (!setId || !Number.isInteger(caseId)) {
        return errorResponse(400, 'invalid_request', 'Missing or invalid setId/caseId path parameters.');
    }

    const algorithmSet = await docClient.send(
        new GetCommand({
            TableName: process.env.ALGORITHM_SETS_TABLE_NAME!,
            Key: { setId },
        }),
    );
    if (!algorithmSet.Item) {
        return errorResponse(404, 'not_found', `Unknown algorithm set "${setId}".`);
    }

    const caseItem = await docClient.send(
        new GetCommand({
            TableName: process.env.CASES_TABLE_NAME!,
            Key: { setId, caseId },
        }),
    );
    if (!caseItem.Item) {
        return errorResponse(404, 'not_found', `Unknown case ${caseId} in algorithm set "${setId}".`);
    }

    const result = await docClient.send(
        new QueryCommand({
            TableName: process.env.ALGORITHMS_TABLE_NAME!,
            IndexName: 'ByCaseVotes',
            KeyConditionExpression: 'setIdCaseId = :setIdCaseId',
            ExpressionAttributeValues: { ':setIdCaseId': `${setId}#${caseId}` },
            ScanIndexForward: false,
        }),
    );

    const algorithms = (result.Items ?? []).map((item) => ({
        algorithmId: item.algorithmId as string,
        notation: item.notation as string,
        votes: item.votes as number,
    }));

    return jsonResponse(200, { algorithms });
};

// PUT /algorithm-sets/{setId}/cases/{caseId}/vote - see
// docs/cube-app-api-spec.md §4.4.
const castVote = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const setId = event.pathParameters?.setId;
    const caseId = Number(event.pathParameters?.caseId);
    if (!setId || !Number.isInteger(caseId)) {
        return errorResponse(400, 'invalid_request', 'Missing or invalid setId/caseId path parameters.');
    }

    const { installationId, algorithmId } = JSON.parse(event.body ?? '{}');
    if (typeof installationId !== 'string' || typeof algorithmId !== 'string') {
        return errorResponse(400, 'invalid_request', 'Missing or invalid "installationId"/"algorithmId" field.');
    }

    const setIdCaseId = `${setId}#${caseId}`;

    // A miss here means either algorithmId doesn't exist at all, or it
    // belongs to a different case - both are the same 404, since
    // Algorithms' key is already (setIdCaseId, algorithmId): no separate
    // lookup-by-bare-algorithmId index needed (see spec §4.4).
    const targetAlgorithm = await docClient.send(
        new GetCommand({
            TableName: process.env.ALGORITHMS_TABLE_NAME!,
            Key: { setIdCaseId, algorithmId },
        }),
    );
    if (!targetAlgorithm.Item) {
        return errorResponse(404, 'not_found', `Unknown algorithmId "${algorithmId}" for case ${caseId}.`);
    }
    const currentVotes = targetAlgorithm.Item.votes as number;

    const priorVote = await docClient.send(
        new GetCommand({
            TableName: process.env.VOTES_TABLE_NAME!,
            Key: { installationId, setIdCaseId },
        }),
    );
    const priorAlgorithmId = priorVote.Item?.algorithmId as string | undefined;

    if (priorAlgorithmId === algorithmId) {
        // Idempotent: already voted for this algorithm, nothing to change.
        return jsonResponse(200, { caseId, algorithmId, votes: currentVotes });
    }

    const now = new Date().toISOString();

    // Move the vote atomically - see the note on TransactWriteItems in
    // submitAlgorithm() above; same concern applies here.
    await docClient.send(
        new TransactWriteCommand({
            TransactItems: [
                {
                    Update: {
                        TableName: process.env.ALGORITHMS_TABLE_NAME!,
                        Key: { setIdCaseId, algorithmId },
                        UpdateExpression: 'SET votes = votes + :one',
                        ExpressionAttributeValues: { ':one': 1 },
                    },
                },
                ...(priorAlgorithmId
                    ? [
                          {
                              Update: {
                                  TableName: process.env.ALGORITHMS_TABLE_NAME!,
                                  Key: { setIdCaseId, algorithmId: priorAlgorithmId },
                                  UpdateExpression: 'SET votes = votes - :one',
                                  ExpressionAttributeValues: { ':one': 1 },
                              },
                          },
                      ]
                    : []),
                {
                    Put: {
                        TableName: process.env.VOTES_TABLE_NAME!,
                        Item: { installationId, setIdCaseId, algorithmId, votedAt: now },
                    },
                },
            ],
        }),
    );

    return jsonResponse(200, { caseId, algorithmId, votes: currentVotes + 1 });
};

// POST /algorithm-sets/{setId}/cases/{caseId}/algorithms - see
// docs/cube-app-api-spec.md §4.3.
const submitAlgorithm = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const setId = event.pathParameters?.setId;
    const caseId = Number(event.pathParameters?.caseId);
    if (!setId || !Number.isInteger(caseId)) {
        return errorResponse(400, 'invalid_request', 'Missing or invalid setId/caseId path parameters.');
    }

    const { installationId, notation } = JSON.parse(event.body ?? '{}');
    if (typeof installationId !== 'string' || typeof notation !== 'string') {
        return errorResponse(400, 'invalid_request', 'Missing or invalid "installationId"/"notation" field.');
    }
    if (notation.length > MAX_NOTATION_LENGTH) {
        return errorResponse(400, 'invalid_request', `notation must be at most ${MAX_NOTATION_LENGTH} characters.`);
    }

    const normalizedProposal = normalizeNotation(notation);

    const algorithmSet = await docClient.send(
        new GetCommand({
            TableName: process.env.ALGORITHM_SETS_TABLE_NAME!,
            Key: { setId },
        }),
    );
    if (!algorithmSet.Item) {
        return errorResponse(404, 'not_found', `Unknown algorithm set "${setId}".`);
    }

    const caseItem = await docClient.send(
        new GetCommand({
            TableName: process.env.CASES_TABLE_NAME!,
            Key: { setId, caseId },
        }),
    );
    if (!caseItem.Item) {
        return errorResponse(404, 'not_found', `Unknown case ${caseId} in algorithm set "${setId}".`);
    }

    const { cubeType, mask } = algorithmSet.Item as { cubeType: string; mask: string };
    const { scramble } = caseItem.Item as { scramble: string };

    const invalidMove = findInvalidMove(normalizedProposal, cubeType);
    if (invalidMove) {
        return errorResponse(422, 'invalid_algorithm', `"${invalidMove}" is not a valid move for a ${cubeType} cube.`);
    }

    const cube = new NormalCube(cubeSizeForType(cubeType));
    cube.applyIgnoreMask(mask);
    cube.applyMoves(scramble);
    cube.applyMoves(normalizedProposal);

    if (!cube.isSolved()) {
        return errorResponse(422, 'invalid_algorithm', 'Sequence does not solve this case.');
    }

    const setIdCaseId = `${setId}#${caseId}`;

    // String-level duplicate check only (per spec) - reads then writes, so
    // two identical submissions arriving at the exact same instant could
    // both slip past this and create two rows. Accepted risk, same as the
    // spec's other "revisit only if it becomes a real problem" notes.
    const existingAlgorithms = await docClient.send(
        new QueryCommand({
            TableName: process.env.ALGORITHMS_TABLE_NAME!,
            KeyConditionExpression: 'setIdCaseId = :setIdCaseId',
            ExpressionAttributeValues: { ':setIdCaseId': setIdCaseId },
        }),
    );
    const duplicate = (existingAlgorithms.Items ?? []).find((item) => item.notation === normalizedProposal);
    if (duplicate) {
        return jsonResponse(409, {
            error: 'duplicate_algorithm',
            message: 'This notation has already been submitted for this case.',
            algorithmId: duplicate.algorithmId,
        });
    }

    const priorVote = await docClient.send(
        new GetCommand({
            TableName: process.env.VOTES_TABLE_NAME!,
            Key: { installationId, setIdCaseId },
        }),
    );
    const priorAlgorithmId = priorVote.Item?.algorithmId as string | undefined;

    const algorithmId = randomUUID();
    const now = new Date().toISOString();

    // Create the algorithm and cast the submitter's auto-vote atomically -
    // TransactWriteItems (all-or-nothing) so a crash or concurrent request
    // between these writes can never leave votes drifted from reality.
    await docClient.send(
        new TransactWriteCommand({
            TransactItems: [
                {
                    Put: {
                        TableName: process.env.ALGORITHMS_TABLE_NAME!,
                        Item: { setIdCaseId, algorithmId, notation: normalizedProposal, votes: 1, createdAt: now },
                    },
                },
                ...(priorAlgorithmId
                    ? [
                          {
                              Update: {
                                  TableName: process.env.ALGORITHMS_TABLE_NAME!,
                                  Key: { setIdCaseId, algorithmId: priorAlgorithmId },
                                  UpdateExpression: 'SET votes = votes - :one',
                                  ExpressionAttributeValues: { ':one': 1 },
                              },
                          },
                      ]
                    : []),
                {
                    Put: {
                        TableName: process.env.VOTES_TABLE_NAME!,
                        Item: { installationId, setIdCaseId, algorithmId, votedAt: now },
                    },
                },
            ],
        }),
    );

    return jsonResponse(201, { algorithmId, notation: normalizedProposal, votes: 1 });
};

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const method = event.httpMethod.toLowerCase();

        if (method === 'get' && event.resource === '/algorithm-sets/{setId}/top-algorithms') {
            return await getTopAlgorithms(event);
        }
        if (method === 'get' && event.resource === '/algorithm-sets/{setId}/cases/{caseId}/algorithms') {
            return await listAlgorithms(event);
        }
        if (method === 'post' && event.resource === '/algorithm-sets/{setId}/cases/{caseId}/algorithms') {
            return await submitAlgorithm(event);
        }
        if (method === 'put' && event.resource === '/algorithm-sets/{setId}/cases/{caseId}/vote') {
            return await castVote(event);
        }

        return errorResponse(404, 'not_found', 'Unknown route.');
    } catch (err) {
        console.log(err);
        return errorResponse(500, 'internal_error', 'Unexpected server error.');
    }
};
