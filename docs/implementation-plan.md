# Implementation Plan — Speedcubing Algorithm API

Roadmap for building the backend described in the API spec (single Lambda,
internal routing, DynamoDB-backed). See the spec for full endpoint/data-model
detail; this doc tracks the build order and open decisions.

## Phase 1 — Infrastructure (`template.yaml`)
1. Add three DynamoDB tables: `Cases` (PK `setId`, SK `caseId`), `Algorithms`
   (PK `setId#caseId`, SK `algorithmId`, GSI `ByCaseVotes` on `votes`),
   `Votes` (PK `installationId`, SK `setId#caseId`). Use `PAY_PER_REQUEST`
   billing — no capacity planning needed at this scale.
2. Attach the four routes as separate `Events` entries on the same
   `ApiFunction` (`GET .../top-algorithms`, `GET .../algorithms`,
   `POST .../algorithms`, `PUT .../vote`) — one function, multiple triggers,
   internal dispatch on method+path.
3. Grant the function DynamoDB access via `DynamoDBCrudPolicy` (or a
   hand-written least-privilege policy) per table.
4. Decide the rate-limiting mechanism (plain API Gateway usage plans
   throttle overall/per-key, not per-IP — true per-IP throttling needs an
   AWS WAF rate-based rule on the stage). Pair with Lambda reserved
   concurrency as a hard cost cap regardless of source.

## Phase 2 — Code structure
5. Internal router in `api/app.ts` (or split into `router.ts` +
   `api/handlers/*.ts`) dispatching on `event.resource`/`event.httpMethod`.
6. Shared TypeScript types matching the spec's request/response shapes, plus
   a response helper that always emits the `{ error, message }` envelope on
   failures.
7. A data-access module per table (thin repository functions: get/list/put)
   so handlers stay focused on business logic.

## Phase 3 — Cube validation engine
8. Decide build-vs-reuse for the move simulator (must support Singmaster
   notation, `x y z` rotations, lowercase wide moves). Needs its own unit
   test suite (known scrambles + known solving/non-solving algorithms)
   before it's wired into the submit endpoint.

## Phase 4 — Endpoint logic
9. `top-algorithms`: query `Cases` by `setId` for all `caseId`s, then
   `Query` the `ByCaseVotes` GSI per case with `Limit=1`.
10. `GET algorithms`: `Query` the same GSI, no limit, descending, for the
    full sorted list.
11. `POST algorithms`: normalize → duplicate check → validate (Phase 3) →
    `TransactWriteItems` (create algorithm + upsert vote, adjusting counts).
12. `PUT vote`: `GetItem` on the exact `(setId#caseId, algorithmId)` key to
    confirm membership → `TransactWriteItems` to move the vote and adjust
    both counts.

## Phase 5 — Seed data
13. One-off script (not part of the API) to seed `Cases` (scramble state +
    cubeType) and one default `Algorithms` row per case. Decide the
    authoring format (e.g. a JSON file per set, checked into the repo).

## Phase 6 — Testing
14. Unit-test each handler with a mocked DynamoDB client (e.g.
    `aws-sdk-client-mock`).
15. Exercise the full stack locally with `sam local start-api` against
    DynamoDB Local before ever touching real AWS tables.

## Phase 7 — Deploy
16. `aws configure`, then `sam deploy --guided` to stand up the real
    tables/API/IAM, then run the seed script against them.
