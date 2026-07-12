import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { lambdaHandler } from '../../app';
import { docClient } from '../../db';
import { buildEvent as buildBaseEvent } from './testHelpers';
import { expect, describe, it, beforeEach } from '@jest/globals';

process.env.ALGORITHMS_TABLE_NAME = 'Algorithms';
process.env.VOTES_TABLE_NAME = 'Votes';

const ddbMock = mockClient(docClient);
const SET_ID_CASE_ID = 'OLL#1';

const buildEvent = (overrides: Parameters<typeof buildBaseEvent>[0]) =>
    buildBaseEvent({
        httpMethod: 'put',
        path: '/algorithm-sets/OLL/cases/1/vote',
        pathParameters: { setId: 'OLL', caseId: '1' },
        resource: '/algorithm-sets/{setId}/cases/{caseId}/vote',
        ...overrides,
    });

describe('PUT /algorithm-sets/{setId}/cases/{caseId}/vote', () => {
    beforeEach(() => {
        ddbMock.reset();
        ddbMock
            .on(GetCommand, { TableName: 'Algorithms' })
            .resolves({ Item: { setIdCaseId: SET_ID_CASE_ID, algorithmId: 'a2', notation: 'x', votes: 10 } });
        ddbMock.on(GetCommand, { TableName: 'Votes' }).resolves({ Item: undefined });
        ddbMock.on(TransactWriteCommand).resolves({});
    });

    it('casts a fresh vote (no prior vote) and increments the target algorithm', async () => {
        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1', algorithmId: 'a2' }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(200);
        expect(JSON.parse(result.body)).toEqual({ caseId: 1, algorithmId: 'a2', votes: 11 });

        const [transactCall] = ddbMock.commandCalls(TransactWriteCommand);
        const items = transactCall.args[0].input.TransactItems ?? [];
        expect(items).toHaveLength(2); // Update target + Put vote, no prior algorithm to decrement
        expect(items[0].Update).toMatchObject({
            TableName: 'Algorithms',
            Key: { setIdCaseId: SET_ID_CASE_ID, algorithmId: 'a2' },
            UpdateExpression: 'SET votes = votes + :one',
        });
        expect(items[1].Put).toMatchObject({
            TableName: 'Votes',
            Item: { installationId: 'install-1', setIdCaseId: SET_ID_CASE_ID, algorithmId: 'a2' },
        });
    });

    it('moves the vote off the old algorithm when switching to a different one', async () => {
        ddbMock
            .on(GetCommand, { TableName: 'Votes' })
            .resolves({ Item: { installationId: 'install-1', setIdCaseId: SET_ID_CASE_ID, algorithmId: 'a1' } });

        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1', algorithmId: 'a2' }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(200);
        expect(JSON.parse(result.body)).toEqual({ caseId: 1, algorithmId: 'a2', votes: 11 });

        const [transactCall] = ddbMock.commandCalls(TransactWriteCommand);
        const items = transactCall.args[0].input.TransactItems ?? [];
        expect(items).toHaveLength(3); // Update new algorithm + Update old algorithm + Put vote
        expect(items[1].Update).toMatchObject({
            TableName: 'Algorithms',
            Key: { setIdCaseId: SET_ID_CASE_ID, algorithmId: 'a1' },
            UpdateExpression: 'SET votes = votes - :one',
        });
    });

    it('is idempotent when voting for the same algorithm again, with no writes', async () => {
        ddbMock
            .on(GetCommand, { TableName: 'Votes' })
            .resolves({ Item: { installationId: 'install-1', setIdCaseId: SET_ID_CASE_ID, algorithmId: 'a2' } });

        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1', algorithmId: 'a2' }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(200);
        expect(JSON.parse(result.body)).toEqual({ caseId: 1, algorithmId: 'a2', votes: 10 });
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('returns 404 when algorithmId does not exist (or belongs to a different case)', async () => {
        ddbMock.on(GetCommand, { TableName: 'Algorithms' }).resolves({ Item: undefined });

        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1', algorithmId: 'unknown' }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(404);
        expect(JSON.parse(result.body)).toEqual({
            error: 'not_found',
            message: 'Unknown algorithmId "unknown" for case 1.',
        });
        expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it('returns 400 when installationId is missing', async () => {
        const event = buildEvent({ body: JSON.stringify({ algorithmId: 'a2' }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_request',
            message: 'Missing or invalid "installationId"/"algorithmId" field.',
        });
    });

    it('returns 400 when algorithmId is missing', async () => {
        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1' }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_request',
            message: 'Missing or invalid "installationId"/"algorithmId" field.',
        });
    });

    it('returns 400 when caseId is not numeric', async () => {
        const event = buildEvent({
            pathParameters: { setId: 'OLL', caseId: 'nope' },
            body: JSON.stringify({ installationId: 'install-1', algorithmId: 'a2' }),
        });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_request',
            message: 'Missing or invalid setId/caseId path parameters.',
        });
    });
});
