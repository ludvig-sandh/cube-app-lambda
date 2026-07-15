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

### Seeding algorithm sets

Drop a `seed-data/<SETID>.json` file per set (e.g. `seed-data/OLL.json`) -
the set's ID comes from the file name:

```json
{
  "cubeType": "3x3",
  "mask": "############\n############\n############\n............\n############\n############\n############\n############\n############",
  "algorithms": ["R U R' U R U2 R'", "..."]
}
```

`mask` is the string `NormalCube.applyIgnoreMask()` takes - which cells this
set doesn't care about (e.g. OLL wildcards the last layer's side stickers,
one line per grid row, `.` for don't-care). `algorithms` is one *solving*
algorithm per case, in case order.

Then run against DynamoDB Local (with `docker compose up -d` running):

```bash
cd api && DYNAMODB_ENDPOINT=http://localhost:8000 npm run seed
```

Without `DYNAMODB_ENDPOINT` set, the script talks to real AWS DynamoDB
instead, using whatever AWS credentials are active in your shell (e.g.
`cube-app-deployer` via `aws configure`) - useful for seeding a deployed
stack's tables:

```bash
cd api && npm run seed
```

This seeds every `seed-data/*.json` file in one pass.
Safe to re-run - overwrites rather than duplicating. Adding a new set is
just dropping in another `seed-data/<SETID>.json` file.

### Resetting votes & submissions

To wipe all user-generated data (every submitted algorithm and every vote)
and restore each case to its single seeded default at 0 votes - e.g. after
a bug produced bad data - run:

```bash
cd api && DYNAMODB_ENDPOINT=http://localhost:8000 npm run reset   # local
cd api && npm run reset                                           # real AWS
```

This deletes every item in the `Algorithms` and `Votes` tables (leaving
`AlgorithmSets`/`Cases` untouched, since those are set/case metadata, not
user data), then re-runs `npm run seed` automatically. **Irreversible** -
double-check `DYNAMODB_ENDPOINT`/AWS credentials before running this
against the real deployed tables.

Install dependencies:

```bash
cd api && npm install && cd ..
```

Build the function (compiles TypeScript via esbuild, output goes to `.aws-sam/build`):

```bash
sam build
```

Invoke the function directly with a sample event, wired to DynamoDB Local
(requires `docker compose up -d` running). Without the two flags below, the
Lambda's DynamoDB calls go to real AWS instead - `DynamoDBEndpointOverride`
defaults to blank specifically so a real `sam deploy` never accidentally
points at a local endpoint:

```bash
sam local invoke ApiFunction --event events/submit-algorithm-event.json \
  --docker-network cube-app-lambda_default \
  --parameter-overrides DynamoDBEndpointOverride=http://cube-app-dynamodb-local:8000
```

Run a local API Gateway emulator on port 3000, same wiring:

```bash
sam local start-api \
  --docker-network cube-app-lambda_default \
  --parameter-overrides DynamoDBEndpointOverride=http://cube-app-dynamodb-local:8000
curl -X POST http://localhost:3000/algorithm-sets/OLL/cases/1/algorithms \
  -H "Content-Type: application/json" \
  -d '{"installationId": "test", "notation": "R U R'"'"' U R U2 R'"'"'"}'
```

Note: the API requires an `x-api-key` header once deployed (see below), but
`sam local start-api` doesn't enforce that - it's a real API Gateway
feature, not something the local emulator reproduces - so no key is needed
for local requests like the one above.

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

### API key

Every route requires an `x-api-key` header (see `Globals.Api.Auth` in
`template.yaml`) - a shared secret baked into the app build, meant to block
casual/scripted abuse rather than authenticate individual users. API
Gateway generates the actual key value at deploy time; it's never written
into `template.yaml` or anywhere else in this repo, since the repo is
public. After deploying, fetch it once with:

```bash
aws apigateway get-api-key \
  --api-key "$(aws cloudformation describe-stacks --stack-name cube-app-lambda \
      --query "Stacks[0].Outputs[?OutputKey=='ApiKeyId'].OutputValue" --output text)" \
  --include-value --query value --output text
```

Store that value only in the mobile app's build config (outside this
repo) and send it as `x-api-key` on every request.

## Next steps

- Add request validation (e.g. via API Gateway request models/validators in `template.yaml`, or in code).
- Add a DynamoDB table resource to `template.yaml` and wire up read/write access from `api/app.ts`.
