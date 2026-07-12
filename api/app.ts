import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './db';
import { NormalCube } from './cube/NormalCube';
import { normalizeNotation } from './cube/notation';

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

// POST /algorithm-sets/{setId}/cases/{caseId}/algorithms - see
// docs/cube-app-api-spec.md §4.3.
//
// For now this only normalizes and validates the submitted notation - it
// doesn't check for duplicates, store the algorithm, or auto-vote yet
// (that needs the Algorithms/Votes tables wired up next), so a valid
// submission gets a placeholder 200 rather than the spec's eventual 201.
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

    const cube = new NormalCube(cubeSizeForType(cubeType));
    cube.applyIgnoreMask(mask);
    cube.applyMoves(scramble);
    cube.applyMoves(normalizeNotation(notation));

    if (!cube.isSolved()) {
        return errorResponse(422, 'invalid_algorithm', 'Sequence does not solve this case.');
    }

    // TODO: reject exact-duplicate normalized notation (409), create the
    // algorithm, auto-vote for the submitter, and return 201 with
    // { algorithmId, notation, votes } once submission storage exists.
    return jsonResponse(200, { valid: true });
};

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        if (
            event.httpMethod.toLowerCase() === 'post' &&
            event.resource === '/algorithm-sets/{setId}/cases/{caseId}/algorithms'
        ) {
            return await submitAlgorithm(event);
        }

        return errorResponse(404, 'not_found', 'Unknown route.');
    } catch (err) {
        console.log(err);
        return errorResponse(500, 'internal_error', 'Unexpected server error.');
    }
};
