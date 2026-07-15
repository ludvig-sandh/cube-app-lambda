# Speedcubing Algorithm App — API Specification

## 1. Overview

An app that teaches speedcubing algorithm sets (OLL, PLL, F2L, etc.). Each set
contains a fixed number of **cases** (e.g. OLL has 57). Each case can have
multiple **algorithms** (move sequences that solve it). Users can browse
algorithms for a case, vote for the one they think is best, and submit their
own algorithm proposals. There are no user accounts — each app install has a
locally-generated **installation ID** that identifies it for voting purposes.

- Algorithm sets and cases (which ones exist, how many, their names) are
  **hardcoded client-side** — the API never needs to list or serve them.
- Algorithm set names are globally unique — there will never be two sets
  named e.g. `PLL` across different cube types. So `setId` alone is enough
  to address a set/case/algorithm; `cubeType` (e.g. `3x3`) is tracked as an
  attribute for internal use (the validator needs to know which cube
  mechanics to simulate) rather than as part of any lookup key or URL.
- When scrolling through the cases in a set, the app shows the **most-voted
  algorithm** for each case by default, or the installation's own vote if it
  has one for that case.
- Tapping into a case shows **all** submitted algorithms for that case so the
  user can compare and vote.
- Submitted algorithms go **live immediately** — no moderation queue. The
  Lambda validates the notation by simulating the moves against the case's
  scrambled state and confirming it reaches solved. Invalid notation is
  rejected at submission time, so nothing unsolvable is ever stored.
- No descriptions, images, or SVG diagrams are handled by this API — that's
  all client-side/static.

## 2. Client-Side State & Sync Behavior

Each case's "which algorithm do I show" decision is resolved **client-side**
from up to three sources:

1. **User's custom selection** (local, per case) — if the user has
   explicitly picked/voted for an algorithm on this case, show it. Empty by
   default.
2. **Most-voted algorithm** (from `GET .../top-algorithms`, §4.1) — used to
   seed brand-new installs.
3. **Hardcoded default algorithm** (bundled in the app) — the fallback for
   installs that haven't customized a case and haven't been seeded from the
   most-voted flow.

**New installs**: on first launch, call `top-algorithms` once per known
`setId` and use the results to seed the local selection for every case,
in place of the hardcoded defaults. This is a **read-only local seed** —
it must **not** call the vote endpoint automatically. Confirmed: votes
should only ever be cast from an explicit user action — picking an
algorithm on the "view alternate algorithms" screen (§4.2 → §4.4), or
submitting a new one (§4.3, which auto-votes for the submitter's own
algorithm, see below) — never automatically just from displaying/seeding a
default. Auto-crediting a vote just for using the top-voted algorithm on
first launch would create a rich-get-richer bias where the current leader
keeps winning by default.

**Existing installs** (already using the app before this feature ships): do
**not** retroactively replace their hardcoded per-case defaults with the
most-voted algorithm — that would silently change behavior users are
already used to. A case with no custom selection keeps showing the bundled
default, unchanged.

**"Selecting" and "voting" are the same action**: whenever a user picks an
algorithm from the list of alternatives for a case (`GET .../algorithms`,
§4.2) — whether presented to them as "choose" or "vote" — the client should:
  1. Update the local custom selection for that case to the chosen algorithm.
  2. Call `PUT .../vote` (§4.4) with that `algorithmId`.

**Submitting a new algorithm (§4.3) is also a select/vote action.** The
server automatically counts the submitter's vote for their own new
algorithm as part of the submission — the client should update its local
custom selection to the new `algorithmId` on a successful submit, without
a separate `PUT .../vote` call.

There is no "no selection" state and no vote-removal endpoint — exactly one
algorithm is always selected per case (radio-button semantics), whether
that's the user's own pick or the current default.

This is all client-side bookkeeping — the API itself doesn't need to know
or care whether an install is "new" or "existing"; it just serves
top-voted/per-case algorithms and records votes.

## 3. Core Concepts / Data Model

| Entity | Description | Managed by |
|---|---|---|
| Algorithm | A notation string that solves a specific case. | Users (via API) + one seeded row per case (the app's current hardcoded default), inserted directly into the `Algorithms` table so there's always at least one algorithm to show before any user submits alternates |
| Vote | Link between an installation ID and the algorithm it picked for a case. Changeable, always exactly one per (installation, case) — no "unset" state. | Users (via API) |
| Installation ID | Client-generated unique ID (e.g. UUID v4), stored locally on device, sent with every vote/submission and used to restore the user's picks. | Frontend |
| Case (identity only) | `caseId` is just a **number** (e.g. `27`), unique only *within* its set, not globally — the app already knows it's e.g. "OLL case 27" because `setId` is part of the URL/path context. The API doesn't serve case lists, but a small internal table maps `(setId, caseId)` → scramble state (plus a `cubeType` attribute) so the submission Lambda can validate proposed algorithms with the right cube mechanics. | Developer (seed data, not public) |

### Suggested DynamoDB tables

```
Cases (internal only — not exposed via any public endpoint; the submission
       Lambda reads it with a direct DynamoDB GetItem call, no API hop)
  PK: setId                        e.g. "OLL"
  SK: caseId                       e.g. 27
  attrs: scrambleState, cubeType   scrambleState used by the validation Lambda
                                    to simulate submitted notation; cubeType
                                    (e.g. "3x3") tells it which cube mechanics
                                    to simulate with

Algorithms
  PK: setId#caseId                 e.g. "OLL#27"
  SK: algorithmId                  e.g. ULID/UUID
  attrs: notation, votes (number), createdAt
  GSI "ByCaseVotes": PK=setId#caseId, SK=votes
    → Query(setId#caseId, ScanIndexForward=false, Limit=1) cheaply returns
      the top-voted algorithm for a single case; the "top algorithms for a
      set" endpoint fans this out across the set's caseIds.

Votes
  PK: installationId
  SK: setId#caseId
  attrs: algorithmId, votedAt
```

Since `caseId` is a bare number, it's **not** globally unique on its own —
`OLL` case `27` and some other set's case `27` are different cases. The
`setId#caseId` composite key on `Algorithms`/`Votes` is what prevents that
collision (`Cases` avoids it naturally since `setId` is already its own PK
component).

## 4. Endpoints

All endpoints are JSON over HTTPS (API Gateway → Lambda). No auth beyond the
client-supplied `installationId`, which is **required** (not optional) on
the two write endpoints (§4.3 submit, §4.4 vote) — those are the only
places it's ever sent. Reads (§4.1, §4.2) don't take it at all; "which
algorithm is selected" is resolved entirely client-side (§2).

**Rate limiting**: throttle at roughly **10 requests/second per IP** (e.g.
an API Gateway usage plan / throttle setting) across the API. This won't
stop a determined scripted abuser spreading requests across IPs — accepted
for now; revisit only if it actually becomes a problem.

**Notation format**: standard Singmaster notation (`R U R' U2` ...), plus
**rotations** (`x y z`) and **wide moves** written as **lowercase letters**
(`r u f l d b`) — this is the 3x3 wide-move convention. The submission
validator (§4.3) must support all of these when simulating a proposed
algorithm.

**Parentheses**: submitters may wrap moves in `( )` purely as a visual
grouping/memory aid (e.g. `(R U R' U') (F R F')`) — they don't change which
moves get applied. They're preserved in the stored/returned notation (see
§4.3), but must be well-formed: balanced, a single level deep (no nesting),
and never glued directly to a move with no separating boundary. Malformed
parentheses are rejected at submission time — see §4.3/§5 for the exact
error messages.

---

### 4.1 `GET /algorithm-sets/{setId}/top-algorithms`
For a brand-new install with no vote history yet, return the current
highest-voted algorithm's notation for every case in the set, in one call.
This is used **only** to seed the local per-case selection on first launch
(§2) — not a general "get current state" call, so it carries no
`installationId`, no `algorithmId`, and no vote counts. Once a device has
seeded/customized its selections, it never needs this endpoint again.

**Response 200**
```json
[
  { "caseId": 1, "notation": "R U R' U R U2 R'" },
  { "caseId": 2, "notation": "R U R2' U' R2 U' R2' U2 R" }
]
```

---

### 4.2 `GET /algorithm-sets/{setId}/cases/{caseId}/algorithms`
List all algorithms submitted for a case, sorted by votes descending. Used
when the user taps into a case to see/compare alternatives and vote.

No `installationId` needed — this endpoint doesn't resolve "which one is
selected." The client already has its own locally-saved selected algorithm
for this case and just compares it against the returned list (by
`algorithmId` or `notation`) to highlight the match in the UI.

**Response 200**
```json
{
  "algorithms": [
    { "algorithmId": "a1", "notation": "R U R' U R U2 R'", "votes": 42 },
    { "algorithmId": "a2", "notation": "L' U' L U' L' U2 L", "votes": 10 }
  ]
}
```

---

### 4.3 `POST /algorithm-sets/{setId}/cases/{caseId}/algorithms`
Submit a new algorithm proposal for a case.

**Body**
```json
{ "installationId": "b3f1...", "notation": "R U R' U R U2 R'" }
```

**Behavior**
1. **Reject oversized input**: if `notation` is longer than 200 characters,
   reject with `400 Bad Request` before doing anything else (no DB reads, no
   parsing) — see §5 for the exact message.
2. **Clean** the notation string (trim leading/trailing whitespace, collapse
   internal whitespace runs to a single space). Notation stays
   case-sensitive — lowercase letters are meaningful wide-move notation, not
   noise to clean up. **Parentheses are preserved** in this cleaned string —
   it's exactly what gets stored and returned (see §4 note on parentheses
   above), since they're the submitter's own grouping and don't affect which
   moves get applied.
3. **Validate parentheses**: reject malformed grouping with `422
   Unprocessable Entity` — unbalanced parens, nested parens, or a paren
   glued directly to a move with no separating boundary (e.g. `R(U)R'`).
   See §5 for the exact messages. Nothing is created and no vote is cast.
4. **Reject duplicates**: check the cleaned string (parentheses included)
   against the other algorithms already stored for this case. If one
   matches exactly, reject with `409 Conflict` — do **not** create a new row
   and do **not** cast a vote. This is a string-level check, so two
   functionally-identical sequences written differently are **not** caught
   as duplicates — that includes the same moves grouped with different
   parentheses (e.g. `R U (R' U')` vs `R U R' U'`), which are intentionally
   treated as distinct, separately-voteable entries since the grouping is a
   meaningful part of what the submitter wrote.
5. **Validate moves**: every move (after stripping parentheses, which never
   affect this check) must be a real move for this case's `cubeType` — e.g.
   a 2x2 case rejects lowercase wide moves and slice moves. On an invalid
   move, reject with `422 Unprocessable Entity` — see §5 for the exact
   message.
6. **Validate solve**: Lambda simulates the (parenthesis-stripped) notation
   (supporting Singmaster notation, `x y z` rotations, and lowercase wide
   moves — see notation format above) against this case's known scramble
   state (from the internal `Cases` table) and verifies it reaches solved.
   On failure, reject with `422 Unprocessable Entity`. Nothing is created
   and no vote is cast.
7. **On success**: create the algorithm and **automatically cast the
   submitter's vote for it** (same effect as calling `PUT .../vote` with the
   new `algorithmId`) — so it's created with `votes: 1`, and if the
   submitting installation had a prior vote on this case, that old vote is
   moved off it, same as any other vote change. Creating the algorithm and
   moving the vote must happen atomically — see the note on transactional
   writes below §4.4.

**Response 201**
```json
{ "algorithmId": "a3", "notation": "(R U R') U R U2 R'", "votes": 1 }
```

**Response 400** (see §5 for all 400 cases)
```json
{ "error": "invalid_request", "message": "notation must be at most 200 characters." }
```

**Response 422** — one of several messages under the same `invalid_algorithm`
code; see §5 for the full list
```json
{ "error": "invalid_algorithm", "message": "Sequence does not solve this case." }
```

**Response 409**
```json
{ "error": "duplicate_algorithm", "message": "This notation has already been submitted for this case.", "algorithmId": "a1" }
```

---

### 4.4 `PUT /algorithm-sets/{setId}/cases/{caseId}/vote`
Cast or change the installation's vote for a case.

**Body**
```json
{ "installationId": "b3f1...", "algorithmId": "a2" }
```

**Behavior**
- Reject with `404 Not Found` if `algorithmId` doesn't exist, or exists but
  belongs to a **different** case than the one in the URL — don't just
  check that the ID exists somewhere, confirm it's actually a member of
  this `(setId, caseId)`. Otherwise a buggy or malicious client could link
  a vote to the wrong case's leaderboard. Since `Algorithms`' key is already
  `(setId#caseId, algorithmId)` (§3), this check is just a single `GetItem`
  on that composite key — no separate lookup-by-bare-`algorithmId` index
  needed; a miss means either the ID doesn't exist or it belongs elsewhere,
  and either way the response is the same 404.
- If the installation already voted on this case for a different algorithm,
  that vote is moved (old algorithm `votes -1`, new algorithm `votes +1`).
- Idempotent if voting for the same algorithm again.

**Response 200**
```json
{ "caseId": 1, "algorithmId": "a2", "votes": 11 }
```

---

**A note on atomic writes (applies to §4.3 and §4.4):** both "move a vote"
and "submit + auto-vote" touch multiple items — decrementing the old
algorithm's vote count, incrementing the new one, and writing the vote
record. These must not be three independent, unguarded writes, or
concurrent requests can leave vote counts drifted from reality (e.g. two
requests both read `votes: 5` and both write `votes: 6`, losing one vote).
This spec doesn't prescribe the exact mechanism, but it needs a real answer
during implementation — DynamoDB's `TransactWriteItems` (atomic,
all-or-nothing multi-item writes) is the standard tool for this kind of
"update several related items together" problem; whoever builds the Lambda
should confirm the right approach and its cost/throughput trade-offs.

---

## 5. Error format (all endpoints)

```json
{ "error": "<machine_readable_code>", "message": "<human readable>" }
```

| Status | `error` code | Meaning |
|---|---|---|
| 400 | `invalid_request` | Malformed request (missing/invalid fields, bad path params, oversized notation) |
| 404 | `not_found` | Unknown setId/caseId/algorithmId, or algorithmId doesn't belong to the given case |
| 409 | `duplicate_algorithm` | Exact-string duplicate notation already submitted for this case |
| 409 | `conflict` | Vote state changed concurrently between read and write; safe to retry |
| 422 | `invalid_algorithm` | Notation is malformed or doesn't solve the case — see §5.1 for the specific messages |
| 500 | `internal_error` | Unexpected server error |

The `error` code is coarse and stable — build UI branching on it, not on
`message` text (`message` wording may change). Where a single code covers
several distinct situations (`invalid_request`, `invalid_algorithm`), §5.1
lists every exact `message` currently produced, for cases where the UI
wants to show something more specific than the generic code.

### 5.1 Exact error messages by endpoint

**`POST .../algorithms` (§4.3 submit)**

| Status | `error` | `message` | When |
|---|---|---|---|
| 400 | `invalid_request` | `Missing or invalid setId/caseId path parameters.` | Path missing `setId` or `caseId`, or `caseId` isn't an integer |
| 400 | `invalid_request` | `Missing or invalid "installationId"/"notation" field.` | Body missing `installationId` or `notation`, or either isn't a string |
| 400 | `invalid_request` | `notation must be at most 200 characters.` | `notation` longer than 200 chars |
| 404 | `not_found` | `Unknown algorithm set "<setId>".` | No such algorithm set |
| 404 | `not_found` | `Unknown case <caseId> in algorithm set "<setId>".` | No such case in that set |
| 422 | `invalid_algorithm` | `Unmatched "(" in notation.` | An opening paren has no matching close |
| 422 | `invalid_algorithm` | `Unmatched ")" in notation.` | A closing paren has no matching open |
| 422 | `invalid_algorithm` | `Nested parentheses are not supported.` | A paren group appears inside another |
| 422 | `invalid_algorithm` | `Parentheses must wrap whole moves, not partial moves.` | A paren is glued directly to a move with no separating boundary (e.g. `R(U)R'`) |
| 422 | `invalid_algorithm` | `"<move>" is not a valid move for a <cubeType> cube.` | A move isn't legal for this case's cube type (e.g. a slice move on a 2x2) |
| 422 | `invalid_algorithm` | `Sequence does not solve this case.` | Notation is well-formed and all moves are legal, but simulating it against the scramble doesn't reach solved |
| 409 | `duplicate_algorithm` | `This notation has already been submitted for this case.` | Exact-string match (parens included) with an existing algorithm for this case — response also includes the existing `algorithmId` |

**`PUT .../vote` (§4.4)**

| Status | `error` | `message` | When |
|---|---|---|---|
| 400 | `invalid_request` | `Missing or invalid setId/caseId path parameters.` | Path missing `setId` or `caseId`, or `caseId` isn't an integer |
| 400 | `invalid_request` | `Missing or invalid "installationId"/"algorithmId" field.` | Body missing `installationId` or `algorithmId`, or either isn't a string |
| 404 | `not_found` | `Unknown algorithmId "<algorithmId>" for case <caseId>.` | `algorithmId` doesn't exist, or belongs to a different case |
| 409 | `conflict` | `Vote state changed concurrently; please retry.` | A concurrent vote/submission changed state between this request's read and write; safe to retry |

**`GET .../top-algorithms` (§4.1) and `GET .../algorithms` (§4.2)**

| Status | `error` | `message` | When |
|---|---|---|---|
| 400 | `invalid_request` | `Missing or invalid setId path parameter.` | Path missing `setId` (top-algorithms only) |
| 400 | `invalid_request` | `Missing or invalid setId/caseId path parameters.` | Path missing `setId`/`caseId`, or `caseId` isn't an integer (list-algorithms only) |
| 404 | `not_found` | `Unknown algorithm set "<setId>".` | No such algorithm set |
| 404 | `not_found` | `Unknown case <caseId> in algorithm set "<setId>".` | No such case (list-algorithms only) |

**Any endpoint**

| Status | `error` | `message` | When |
|---|---|---|---|
| 404 | `not_found` | `Unknown route.` | Path doesn't match any defined route |
| 500 | `internal_error` | `Unexpected server error.` | Uncaught exception (e.g. malformed JSON body) |

## 6. Seed data & future considerations

- **Seeding**: both the internal `Cases` table (scramble state per caseId,
  used only for submission validation) and the initial default `Algorithms`
  row per case are seeded directly by the developer, not via the API. Same
  for adding a brand-new algorithm set — a manual, behind-the-scenes action,
  not an API concern.
- **Multi-cube support**: since algorithm set names are globally unique,
  `setId`/`caseId` alone are enough to address everything — no `cubeType`
  in any URL or partition key. `cubeType` lives only as an attribute on
  the internal `Cases` table (§3), so the validation Lambda knows which
  cube mechanics to simulate. Adding a new cube type later is just seeding
  new `Cases`/`Algorithms` rows with that `cubeType` attribute — no schema
  or route changes needed.
- **Scripted abuse beyond per-IP throttling**: not handled — accepted risk
  for now per the rate-limiting note in §4; revisit only if it becomes an
  actual problem.
