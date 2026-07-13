// Validates a one-handed-friendly algorithm set (e.g. seed-data/OLL-OH.json)
// by submitting each algorithm to its corresponding two-handed set via the
// API (e.g. "OLL"), relying on the submit endpoint's own cube-solve
// validation (docs/cube-app-api-spec.md §4.3) instead of re-implementing it
// here.
//
// The one-handed set's algorithms are assumed to be in the same case order
// as the target set (both have the same number of entries) - so
// algorithms[i] is submitted against case i+1 of the target set.
//
// A 201 (created) or 409 (duplicate_algorithm) response means the algorithm
// actually solves that case - the submit Lambda only reaches either of
// those after its cube simulation confirms the solve. A 422
// (invalid_algorithm) means it does not solve that case, and needs manual
// attention.
//
// Usage:
//   node scripts/validate-one-handed.mjs <ohSetId> [baseUrl]
// e.g. node scripts/validate-one-handed.mjs PLL-OH
// Derives the target set by stripping the trailing "-OH" (PLL-OH -> PLL),
// and reads algorithms from seed-data/<ohSetId>.json.
// baseUrl defaults to http://localhost:3000 (sam local start-api - see
// README.md). Requires DynamoDB Local seeded with `npm run seed`
// (api/scripts/seed-algorithm-sets.ts) so the target set's Cases table has
// scrambles for every case.

import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ohSetId = process.argv[2];
if (!ohSetId || !ohSetId.endsWith('-OH')) {
    console.error('Usage: node scripts/validate-one-handed.mjs <ohSetId> [baseUrl]  (ohSetId must end in "-OH", e.g. PLL-OH)');
    process.exit(1);
}
const targetSetId = ohSetId.slice(0, -'-OH'.length);
const baseUrl = process.argv[3] ?? 'http://localhost:3000';

async function submitAlgorithm(caseId, notation) {
    const res = await fetch(`${baseUrl}/algorithm-sets/${targetSetId}/cases/${caseId}/algorithms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId: randomUUID(), notation }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

async function main() {
    const { algorithms } = JSON.parse(readFileSync(join(__dirname, '..', 'seed-data', `${ohSetId}.json`), 'utf-8'));
    console.log(`Validating ${algorithms.length} algorithms from seed-data/${ohSetId}.json against "${targetSetId}" (${baseUrl})...\n`);

    const failures = [];

    for (const [index, notation] of algorithms.entries()) {
        const caseId = index + 1;
        const { status, body } = await submitAlgorithm(caseId, notation);

        if (status === 201) {
            console.log(`Case ${caseId}: OK (created ${body.algorithmId}) - "${notation}"`);
        } else if (status === 409) {
            console.log(`Case ${caseId}: OK (duplicate of ${body.algorithmId}) - "${notation}"`);
        } else {
            console.log(`Case ${caseId}: FAIL (${status} ${body.error ?? ''}) - "${notation}"`);
            failures.push({ caseId, notation, status, body });
        }
    }

    console.log(`\n${algorithms.length - failures.length}/${algorithms.length} algorithms validated OK.`);
    if (failures.length > 0) {
        console.log(`\n${failures.length} failure(s):`);
        for (const failure of failures) {
            console.log(`  Case ${failure.caseId}: "${failure.notation}" -> ${failure.status} ${JSON.stringify(failure.body)}`);
        }
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
