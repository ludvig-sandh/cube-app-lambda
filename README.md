## AWS Lambda function for The Cube App

A serverless application (AWS SAM) with a Lambda function triggered by API Gateway. It reads/writes to DynamoDB.

## Project layout

- `api/` — Lambda function source (TypeScript). `app.ts` is the handler entrypoint.
- `api/tests/unit/` — unit tests (Jest).
- `events/` — sample event payloads for `sam local invoke`.
- `template.yaml` — SAM/CloudFormation template defining the Lambda function, API Gateway route, and (later) DynamoDB table.
- `samconfig.toml` — saved parameters for `sam build` / `sam deploy` / `sam local`.

## Local development

### DynamoDB (local)

The API is backed by three DynamoDB tables (`Cases`, `Algorithms`, `Votes` —
see `docs/cube-app-api-spec.md` §3 for the schema). Locally these run in
[DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html)
via Docker instead of real AWS, so you can develop without any AWS
credentials or cost.

Start it (requires Docker running):

```bash
docker compose up -d
```

Create the tables (matches the schema in `template.yaml` exactly; safe to
re-run, skips tables that already exist):

```bash
./scripts/local-dynamodb-create-tables.sh
```

Data persists to `./.dynamodb/` between restarts (gitignored). Poke at it
directly with the AWS CLI pointed at the local endpoint, e.g.:

```bash
aws dynamodb list-tables --endpoint-url http://localhost:8000
aws dynamodb scan --endpoint-url http://localhost:8000 --table-name Algorithms
```

(Any fake `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` will do — DynamoDB
Local doesn't check them, but the AWS CLI still requires something to be
set.)

Tear it down (also wipes local data unless you drop `-v`):

```bash
docker compose down -v
```

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
