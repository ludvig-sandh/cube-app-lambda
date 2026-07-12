import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { NormalCube } from './cube/NormalCube';

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */

// Toy endpoint: applies notation to a fresh 3x3 and reports whether it's
// back to the exact solved state (not just isSolved() - a pure rotation
// would pass isSolved() but isn't the identity).
const checkIdentity = (event: APIGatewayProxyEvent): APIGatewayProxyResult => {
    const { notation } = JSON.parse(event.body ?? '{}');
    if (typeof notation !== 'string') {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: 'invalid_request',
                message: 'Missing or invalid "notation" field.',
            }),
        };
    }

    const cube = new NormalCube(3);
    cube.applyMoves(notation);
    const isIdentity = cube.equals(new NormalCube(3));

    return {
        statusCode: 200,
        body: JSON.stringify({ isIdentity }),
    };
};

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        if (event.httpMethod.toLowerCase() === 'post' && event.resource === '/check-identity') {
            return checkIdentity(event);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'hello world',
            }),
        };
    } catch (err) {
        console.log(err);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'some error happened',
            }),
        };
    }
};
