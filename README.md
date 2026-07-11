## AWS Lambda function for The Cube App

A serverless application (AWS SAM) with a Lambda function triggered by API Gateway. It reads/writes to DynamoDB.

## Project layout

- `api/` — Lambda function source (TypeScript). `app.ts` is the handler entrypoint.
- `api/tests/unit/` — unit tests (Jest).
- `events/` — sample event payloads for `sam local invoke`.
- `template.yaml` — SAM/CloudFormation template defining the Lambda function, API Gateway route, and (later) DynamoDB table.
- `samconfig.toml` — saved parameters for `sam build` / `sam deploy` / `sam local`.

## Prerequisites

- **AWS CLI** and **AWS SAM CLI** — installed via Homebrew (`brew install awscli aws-sam-cli`).
- **Docker Desktop** — installed at `/Applications/Docker.app`. SAM uses Docker to emulate the Lambda execution environment locally. **Launch Docker Desktop once and complete its first-run setup before using `sam local`.**
- **AWS credentials** — needed only for `sam deploy` (not for local build/test). Configure with `aws configure`, or by creating `~/.aws/credentials` by hand.

## Local development

Install dependencies:

```bash
cd api && npm install && cd ..
```

Build the function (compiles TypeScript via esbuild, output goes to `.aws-sam/build`):

```bash
sam build
```

Invoke the function directly with a sample event (requires Docker running):

```bash
sam local invoke ApiFunction --event events/event.json
```

Run a local API Gateway emulator on port 3000 (requires Docker running):

```bash
sam local start-api
curl http://localhost:3000/hello
```

Run unit tests:

```bash
cd api && npm test
```

## Deploy

Requires configured AWS credentials.

```bash
sam build
sam deploy --guided
```

`--guided` walks you through stack name, region, and confirmation prompts, then saves your choices to `samconfig.toml` so future deploys can just be `sam deploy`.

## Next steps

- Add request validation (e.g. via API Gateway request models/validators in `template.yaml`, or in code).
- Add a DynamoDB table resource to `template.yaml` and wire up read/write access from `api/app.ts`.
