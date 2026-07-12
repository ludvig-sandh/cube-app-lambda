import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { lambdaHandler } from '../../app';
import { expect, describe, it } from '@jest/globals';

const baseEvent: APIGatewayProxyEvent = {
    httpMethod: 'get',
    body: '',
    headers: {},
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: {},
    path: '/hello',
    pathParameters: {},
    queryStringParameters: {},
    requestContext: {
        accountId: '123456789012',
        apiId: '1234',
        authorizer: {},
        httpMethod: 'get',
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
        path: '/hello',
        protocol: 'HTTP/1.1',
        requestId: 'c6af9ac6-7b61-11e6-9a41-93e8deadbeef',
        requestTimeEpoch: 1428582896000,
        resourceId: '123456',
        resourcePath: '/hello',
        stage: 'dev',
    },
    resource: '',
    stageVariables: {},
};

describe('Unit test for app handler', function () {
    it('verifies successful response', async () => {
        const event: APIGatewayProxyEvent = { ...baseEvent, resource: '/hello' };
        const result: APIGatewayProxyResult = await lambdaHandler(event);

        expect(result.statusCode).toEqual(200);
        expect(result.body).toEqual(
            JSON.stringify({
                message: 'hello world',
            }),
        );
    });
});

describe('POST /check-identity', () => {
    const buildEvent = (body: unknown): APIGatewayProxyEvent => ({
        ...baseEvent,
        httpMethod: 'post',
        resource: '/check-identity',
        body: JSON.stringify(body),
    });

    it('returns isIdentity: true for a sequence that returns to the exact solved state', async () => {
        const event = buildEvent({ notation: "R U R' U' R U R' U' R U R' U' R U R' U' R U R' U' R U R' U'" });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(200);
        expect(result.body).toEqual(JSON.stringify({ isIdentity: true }));
    });

    it('returns isIdentity: false for a sequence that does not return to solved', async () => {
        const event = buildEvent({ notation: "R U R' U'" });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(200);
        expect(result.body).toEqual(JSON.stringify({ isIdentity: false }));
    });

    it('returns isIdentity: true for an empty notation string', async () => {
        const event = buildEvent({ notation: '' });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(200);
        expect(result.body).toEqual(JSON.stringify({ isIdentity: true }));
    });

    it('returns 400 when notation is missing', async () => {
        const event = buildEvent({});
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_request',
            message: 'Missing or invalid "notation" field.',
        });
    });

    it('returns 400 when notation is not a string', async () => {
        const event = buildEvent({ notation: 123 });
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(400);
        expect(JSON.parse(result.body)).toEqual({
            error: 'invalid_request',
            message: 'Missing or invalid "notation" field.',
        });
    });

    it('returns 500 when the request body is not valid JSON', async () => {
        const event: APIGatewayProxyEvent = {
            ...baseEvent,
            httpMethod: 'post',
            resource: '/check-identity',
            body: 'not json',
        };
        const result = await lambdaHandler(event);

        expect(result.statusCode).toEqual(500);
        expect(JSON.parse(result.body)).toEqual({ message: 'some error happened' });
    });
});
