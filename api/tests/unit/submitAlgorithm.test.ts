import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { lambdaHandler } from '../../app';
import { docClient } from '../../db';
import { expect, describe, it, beforeEach } from '@jest/globals';

process.env.ALGORITHM_SETS_TABLE_NAME = 'AlgorithmSets';
process.env.CASES_TABLE_NAME = 'Cases';

const ddbMock = mockClient(docClient);

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

const baseEvent: APIGatewayProxyEvent = {
    httpMethod: 'post',
    body: '',
    headers: {},
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: {},
    path: '/algorithm-sets/OLL/cases/1/algorithms',
    pathParameters: { setId: 'OLL', caseId: '1' },
    queryStringParameters: {},
    requestContext: {
        accountId: '123456789012',
        apiId: '1234',
        authorizer: {},
        httpMethod: 'post',
        identity: {
            accessKey: '',
            accountId: '',
            apiKey: '',
            apiKeyId: '',
            caller: '',
            clientCert: {
                clientCertPem: '',
                issuerDN: '',
                serialNumber: '',
                subjectDN: '',
                validity: { notAfter: '', notBefore: '' },
            },
            cognitoAuthenticationProvider: '',
            cognitoAuthenticationType: '',
            cognitoIdentityId: '',
            cognitoIdentityPoolId: '',
            principalOrgId: '',
            sourceIp: '',
            user: '',
            userAgent: '',
            userArn: '',
        },
        path: '/algorithm-sets/OLL/cases/1/algorithms',
        protocol: 'HTTP/1.1',
        requestId: 'c6af9ac6-7b61-11e6-9a41-93e8deadbeef',
        requestTimeEpoch: 1428582896000,
        resourceId: '123456',
        resourcePath: '/algorithm-sets/{setId}/cases/{caseId}/algorithms',
        stage: 'dev',
    },
    resource: '/algorithm-sets/{setId}/cases/{caseId}/algorithms',
    stageVariables: {},
};

const buildEvent = (overrides: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent => ({
    ...baseEvent,
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
    });

    it('returns 200 with valid: true for a correct algorithm', async () => {
        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1', notation: SUNE }) });
        const result: APIGatewayProxyResult = await lambdaHandler(event);

        expect(result.statusCode).toEqual(200);
        expect(JSON.parse(result.body)).toEqual({ valid: true });
    });

    it('returns 422 when the algorithm does not solve the case', async () => {
        const event = buildEvent({ body: JSON.stringify({ installationId: 'install-1', notation: "R U R'" }) });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(422);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_algorithm',
            message: 'Sequence does not solve this case.',
        });
    });

    it('normalizes notation before validating (parens stripped, whitespace collapsed)', async () => {
        const event = buildEvent({
            body: JSON.stringify({ installationId: 'install-1', notation: "(R U R') U  R U2 R'" }),
        });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(200);
        expect(JSON.parse(result.body)).toEqual({ valid: true });
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
