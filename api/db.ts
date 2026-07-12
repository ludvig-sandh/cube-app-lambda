import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// DYNAMODB_ENDPOINT is only set for local development (sam local +
// DynamoDB Local) - in a real deployment there's no override, so the SDK
// talks to real AWS DynamoDB using the Lambda's own IAM role.
const endpoint = process.env.DYNAMODB_ENDPOINT;

const client = new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(endpoint
        ? {
              endpoint,
              // DynamoDB Local ignores these entirely, but the SDK still
              // requires *something* to be set before it will issue a request.
              credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          }
        : {}),
});

export const docClient = DynamoDBDocumentClient.from(client);
