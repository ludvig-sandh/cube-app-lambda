import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { lambdaHandler } from '../../app';
import { docClient } from '../../db';
import { buildEvent as buildBaseEvent } from './testHelpers';
import { expect, describe, it, beforeEach } from '@jest/globals';

process.env.ALGORITHM_SETS_TABLE_NAME = 'AlgorithmSets';
process.env.CASES_TABLE_NAME = 'Cases';
process.env.ALGORITHMS_TABLE_NAME = 'Algorithms';

const ddbMock = mockClient(docClient);

const buildEvent = (overrides: Parameters<typeof buildBaseEvent>[0]) =>
    buildBaseEvent({
        httpMethod: 'get',
        path: '/algorithm-sets/OLL/cases/1/algorithms',
        pathParameters: { setId: 'OLL', caseId: '1' },
        resource: '/algorithm-sets/{setId}/cases/{caseId}/algorithms',
        ...overrides,
    });

describe('GET /algorithm-sets/{setId}/cases/{caseId}/algorithms', () => {
    beforeEach(() => {
        ddbMock.reset();
        ddbMock.on(GetCommand, { TableName: 'AlgorithmSets' }).resolves({ Item: { setId: 'OLL', cubeType: '3x3' } });
        ddbMock.on(GetCommand, { TableName: 'Cases' }).resolves({ Item: { setId: 'OLL', caseId: 1, scramble: 'R' } });
    });

    it('returns all algorithms for the case, sorted by votes descending', async () => {
        ddbMock.on(QueryCommand, { TableName: 'Algorithms' }).resolves({
            Items: [
                { algorithmId: 'a1', notation: "R U R' U R U2 R'", votes: 42 },
                { algorithmId: 'a2', notation: "L' U' L U' L' U2 L", votes: 10 },
            ],
        });

        const result = await lambdaHandler(buildEvent({}));

        expect(result.statusCode).toEqual(200);
        expect(JSON.parse(result.body)).toEqual({
            algorithms: [
                { algorithmId: 'a1', notation: "R U R' U R U2 R'", votes: 42 },
                { algorithmId: 'a2', notation: "L' U' L U' L' U2 L", votes: 10 },
            ],
        });
    });

    it('returns an empty list when the case has no algorithms', async () => {
        ddbMock.on(QueryCommand, { TableName: 'Algorithms' }).resolves({ Items: [] });

        const result = await lambdaHandler(buildEvent({}));

        expect(result.statusCode).toEqual(200);
        expect(JSON.parse(result.body)).toEqual({ algorithms: [] });
    });

    it('returns 404 when the algorithm set does not exist', async () => {
        ddbMock.on(GetCommand, { TableName: 'AlgorithmSets' }).resolves({ Item: undefined });

        const result = await lambdaHandler(buildEvent({}));

        expect(result.statusCode).toEqual(404);
        expect(JSON.parse(result.body)).toEqual({ error: 'not_found', message: 'Unknown algorithm set "OLL".' });
    });

    it('returns 404 when the case does not exist', async () => {
        ddbMock.on(GetCommand, { TableName: 'Cases' }).resolves({ Item: undefined });

        const result = await lambdaHandler(buildEvent({}));

        expect(result.statusCode).toEqual(404);
        expect(JSON.parse(result.body)).toEqual({
            error: 'not_found',
            message: 'Unknown case 1 in algorithm set "OLL".',
        });
    });

    it('returns 400 when caseId is not numeric', async () => {
        const result = await lambdaHandler(buildEvent({ pathParameters: { setId: 'OLL', caseId: 'nope' } }));

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_request',
            message: 'Missing or invalid setId/caseId path parameters.',
        });
    });
});
