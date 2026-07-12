import { APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { lambdaHandler } from '../../app';
import { docClient } from '../../db';
import { buildEvent as buildBaseEvent } from './testHelpers';
import { expect, describe, it, beforeEach } from '@jest/globals';

process.env.ALGORITHM_SETS_TABLE_NAME = 'AlgorithmSets';
process.env.CASES_TABLE_NAME = 'Cases';
process.env.ALGORITHMS_TABLE_NAME = 'Algorithms';
process.env.VOTES_TABLE_NAME = 'Votes';

const ddbMock = mockClient(docClient);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Same OLL-style mask used throughout the NormalCube tests: everything
// except the last-layer belt (grid row 3) must match a solved cube exactly.
const OLL_MASK = (() => {
    const width = 12; // size(3) * 4
    const rows = Array.from({ length: 9 }, () => '#'.repeat(width)); // size(3) * 3
    rows[3] = '.'.repeat(width);
    return rows.join('\n');
})();

const SUNE = "R U R' U R U2 R'";
const SUNE_INVERSE = "R U2 R' U' R U' R'";
const SET_ID_CASE_ID = 'OLL#1';

const buildEvent = (overrides: Parameters<typeof buildBaseEvent>[0]) =>
    buildBaseEvent({
        httpMethod: 'post',
        path: '/algorithm-sets/OLL/cases/1/algorithms',
        pathParameters: { setId: 'OLL', caseId: '1' },
        resource: '/algorithm-sets/{setId}/cases/{caseId}/algorithms',
        ...overrides,
    });

describe('POST /algorithm-sets/{setId}/cases/{caseId}/algorithms', () => {
    beforeEach(() => {
        ddbMock.reset();
        ddbMock
            .on(GetCommand, { TableName: 'AlgorithmSets' })
            .resolves({ Item: { setId: 'OLL', cubeType: '3x3', mask: OLL_MASK } });
        ddbMock
            .on(GetCommand, { TableName: 'Cases' })
            .resolves({ Item: { setId: 'OLL', caseId: 1, scramble: SUNE_INVERSE } });
        // Defaults: no existing algorithms for this case, no prior vote.
        ddbMock.on(QueryCommand, { TableName: 'Algorithms' }).resolves({ Items: [] });
        ddbMock.on(GetCommand, { TableName: 'Votes' }).resolves({ Item: undefined });
        ddbMock.on(TransactWriteCommand).resolves({});
    });

    it('returns 201 with a fresh algorithmId and casts the auto-vote, when the submitter has no prior vote', async () => {
        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1', notation: SUNE }) });
        const result: APIGatewayProxyResult = await lambdaHandler(event);

        expect(result.statusCode).toEqual(201);
        const body = JSON.parse(result.body);
        expect(body.algorithmId).toMatch(UUID_PATTERN);
        expect(body.notation).toEqual(SUNE);
        expect(body.votes).toEqual(1);

        const [transactCall] = ddbMock.commandCalls(TransactWriteCommand);
        const items = transactCall.args[0].input.TransactItems ?? [];
        expect(items).toHaveLength(2); // Put algorithm + Put vote, no prior algorithm to decrement
        expect(items[0].Put).toMatchObject({
            TableName: 'Algorithms',
            Item: { setIdCaseId: SET_ID_CASE_ID, notation: SUNE, votes: 1 },
        });
        expect(items[1].Put).toMatchObject({
            TableName: 'Votes',
            Item: { installationId: 'install-1', setIdCaseId: SET_ID_CASE_ID, algorithmId: body.algorithmId },
        });
    });

    it("moves the submitter's prior vote off their old algorithm atomically", async () => {
        ddbMock
            .on(GetCommand, { TableName: 'Votes' })
            .resolves({ Item: { installationId: 'install-1', setIdCaseId: SET_ID_CASE_ID, algorithmId: 'old-algo' } });

        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1', notation: SUNE }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(201);

        const [transactCall] = ddbMock.commandCalls(TransactWriteCommand);
        const items = transactCall.args[0].input.TransactItems ?? [];
        expect(items).toHaveLength(3); // Put new algorithm + Update old algorithm's votes + Put vote
        expect(items[1].Update).toMatchObject({
            TableName: 'Algorithms',
            Key: { setIdCaseId: SET_ID_CASE_ID, algorithmId: 'old-algo' },
            UpdateExpression: 'SET votes = votes - :one',
            ExpressionAttributeValues: { ':one': 1 },
        });
    });

    it('returns 409 with the existing algorithmId when the normalized notation is an exact duplicate', async () => {
        ddbMock.on(QueryCommand, { TableName: 'Algorithms' }).resolves({
            Items: [{ setIdCaseId: SET_ID_CASE_ID, algorithmId: 'existing-algo', notation: SUNE, votes: 5 }],
        });

        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1', notation: SUNE }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(409);
        expect(JSON.parse(result.body)).toEqual({
            error: 'duplicate_algorithm',
            message: 'This notation has already been submitted for this case.',
            algorithmId: 'existing-algo',
        });
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('treats a duplicate check as a normalized-notation match (parens/whitespace ignored)', async () => {
        ddbMock.on(QueryCommand, { TableName: 'Algorithms' }).resolves({
            Items: [{ setIdCaseId: SET_ID_CASE_ID, algorithmId: 'existing-algo', notation: SUNE, votes: 5 }],
        });

        const event = buildEvent({
            body: JSON.stringify({ installationId: 'install-1', notation: "(R U R') U  R U2 R'" }),
        });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(409);
    });

    it('returns 422 when the algorithm does not solve the case', async () => {
        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1', notation: "R U R'" }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(422);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_algorithm',
            message: 'Sequence does not solve this case.',
        });
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('returns 404 when the algorithm set does not exist', async () => {
        ddbMock.on(GetCommand, { TableName: 'AlgorithmSets' }).resolves({ Item: undefined });
        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1', notation: SUNE }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(404);
        expect(JSON.parse(result.body)).toEqual({ error: 'not_found', message: 'Unknown algorithm set "OLL".' });
    });

    it('returns 404 when the case does not exist', async () => {
        ddbMock.on(GetCommand, { TableName: 'Cases' }).resolves({ Item: undefined });
        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1', notation: SUNE }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(404);
        expect(JSON.parse(result.body)).toEqual({
            error: 'not_found',
            message: 'Unknown case 1 in algorithm set "OLL".',
        });
    });

    it('returns 400 when pathParameters are missing', async () => {
        const event = buildEvent({ pathParameters: null });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_request',
            message: 'Missing or invalid setId/caseId path parameters.',
        });
    });

    it('returns 400 when caseId is not numeric', async () => {
        const event = buildEvent({ pathParameters: { setId: 'OLL', caseId: 'not-a-number' } });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_request',
            message: 'Missing or invalid setId/caseId path parameters.',
        });
    });

    it('returns 400 when installationId is missing', async () => {
        const event = buildEvent({ body: JSON.stringify({ notation: SUNE }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_request',
            message: 'Missing or invalid "installationId"/"notation" field.',
        });
    });

    it('returns 400 when notation is missing', async () => {
        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1' }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_request',
            message: 'Missing or invalid "installationId"/"notation" field.',
        });
    });

    it('returns 500 when the request body is not valid JSON', async () => {
        const event = buildEvent({ body: 'not json' });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(500);
        expect(JSON.parse(result.body)).toEqual({ error: 'internal_error', message: 'Unexpected server error.' });
    });
});

describe('unmatched routes', () => {
    it('returns 404 for an unknown route', async () => {
        const event = buildEvent({ resource: '/something-else', httpMethod: 'get' });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(404);
        expect(JSON.parse(result.body)).toEqual({ error: 'not_found', message: 'Unknown route.' });
    });
});
