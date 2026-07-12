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
        path: '/algorithm-sets/OLL/top-algorithms',
        pathParameters: { setId: 'OLL' },
        resource: '/algorithm-sets/{setId}/top-algorithms',
        ...overrides,
    });

describe('GET /algorithm-sets/{setId}/top-algorithms', () => {
    beforeEach(() => {
        ddbMock.reset();
        ddbMock.on(GetCommand, { TableName: 'AlgorithmSets' }).resolves({ Item: { setId: 'OLL', cubeType: '3x3' } });
        ddbMock.on(QueryCommand, { TableName: 'Cases' }).resolves({
            Items: [{ caseId: 1 }, { caseId: 2 }, { caseId: 3 }],
        });
    });

    it('returns the top-voted algorithm for every case in the set, sorted by caseId', async () => {
        ddbMock
            .on(QueryCommand, { TableName: 'Algorithms', ExpressionAttributeValues: { ':setIdCaseId': 'OLL#1' } })
            .resolves({ Items: [{ notation: 'case-1-top', votes: 5 }] });
        ddbMock
            .on(QueryCommand, { TableName: 'Algorithms', ExpressionAttributeValues: { ':setIdCaseId': 'OLL#2' } })
            .resolves({ Items: [{ notation: 'case-2-top', votes: 9 }] });
        ddbMock
            .on(QueryCommand, { TableName: 'Algorithms', ExpressionAttributeValues: { ':setIdCaseId': 'OLL#3' } })
            .resolves({ Items: [{ notation: 'case-3-top', votes: 1 }] });

        const result = await lambdaHandler(buildEvent({}));

        expect(result.statusCode).toEqual(200);
        expect(JSON.parse(result.body)).toEqual([
            { caseId: 1, notation: 'case-1-top' },
            { caseId: 2, notation: 'case-2-top' },
            { caseId: 3, notation: 'case-3-top' },
        ]);
    });

    it('uses the highest-voted algorithm, not just the first one queried', async () => {
        ddbMock
            .on(QueryCommand, { TableName: 'Algorithms', ExpressionAttributeValues: { ':setIdCaseId': 'OLL#1' } })
            .resolves({ Items: [{ notation: 'winner', votes: 42 }] }); // GSI Query already returns votes-descending
        ddbMock.on(QueryCommand, { TableName: 'Algorithms', ExpressionAttributeValues: { ':setIdCaseId': 'OLL#2' } }).resolves({
            Items: [],
        });
        ddbMock.on(QueryCommand, { TableName: 'Algorithms', ExpressionAttributeValues: { ':setIdCaseId': 'OLL#3' } }).resolves({
            Items: [],
        });

        const result = await lambdaHandler(buildEvent({}));

        expect(JSON.parse(result.body)).toContainEqual({ caseId: 1, notation: 'winner' });
    });

    it('omits a case that has no algorithms yet, rather than erroring', async () => {
        ddbMock.on(QueryCommand, { TableName: 'Algorithms', ExpressionAttributeValues: { ':setIdCaseId': 'OLL#1' } }).resolves({
            Items: [{ notation: 'case-1-top', votes: 5 }],
        });
        ddbMock.on(QueryCommand, { TableName: 'Algorithms', ExpressionAttributeValues: { ':setIdCaseId': 'OLL#2' } }).resolves({
            Items: [],
        });
        ddbMock.on(QueryCommand, { TableName: 'Algorithms', ExpressionAttributeValues: { ':setIdCaseId': 'OLL#3' } }).resolves({
            Items: [{ notation: 'case-3-top', votes: 2 }],
        });

        const result = await lambdaHandler(buildEvent({}));

        expect(JSON.parse(result.body)).toEqual([
            { caseId: 1, notation: 'case-1-top' },
            { caseId: 3, notation: 'case-3-top' },
        ]);
    });

    it('returns 404 when the algorithm set does not exist', async () => {
        ddbMock.on(GetCommand, { TableName: 'AlgorithmSets' }).resolves({ Item: undefined });

        const result = await lambdaHandler(buildEvent({}));

        expect(result.statusCode).toEqual(404);
        expect(JSON.parse(result.body)).toEqual({ error: 'not_found', message: 'Unknown algorithm set "OLL".' });
    });

    it('returns 400 when setId path parameter is missing', async () => {
        const result = await lambdaHandler(buildEvent({ pathParameters: null }));

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_request',
            message: 'Missing or invalid setId path parameter.',
        });
    });
});
