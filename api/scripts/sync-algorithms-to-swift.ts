// Overwrites the algorithm arrays in the iOS app's AlgorithmData.swift with
// the now-verified algorithms from seed-data/*.json, so the app ships the
// same algorithms that verify-image-cases.ts/verify-scramble-images.ts
// checked. Only touches the `algsets` dictionary's *values* (the algorithm
// strings themselves) for sets that have a seed-data counterpart - keys with
// no seed-data file (e.g. "4LLL", which was never migrated to this repo's
// seed pipeline) are left untouched. rowsInSections/titles/etc. are separate
// UI-grouping dictionaries and aren't touched either; if a set's algorithm
// count changed, those may need manual review.
//
// Usage: npx ts-node scripts/sync-algorithms-to-swift.ts [path-to-AlgorithmData.swift]
// Defaults to <repo-root>/AlgorithmData.swift.

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SEED_DATA_DIR = join(__dirname, '..', '..', 'seed-data');

// Swift `algsets` key -> seed-data/*.json file name.
const SET_KEY_TO_SEED_FILE: Record<string, string> = {
    OLL: 'OLL.json',
    'OLL - one handed': 'OLL-OH.json',
    PLL: 'PLL.json',
    'PLL - one handed': 'PLL-OH.json',
    F2L: 'F2L.json',
    COLL: 'COLL.json',
    VLS: 'VLS.json',
    WV: 'WV.json',
    CMLL: 'CMLL.json',
    ELL: 'ELL.json',
    'ZBLL - AS': 'ZBLL-AS.json',
    'ZBLL - H': 'ZBLL-H.json',
    'ZBLL - L': 'ZBLL-L.json',
    'ZBLL - Pi': 'ZBLL-PI.json',
    'ZBLL - S': 'ZBLL-S.json',
    'ZBLL - T': 'ZBLL-T.json',
    'ZBLL - U': 'ZBLL-U.json',
    CLL: 'CLL.json',
    'EG-1': 'EG-1.json',
    'EG-2': 'EG-2.json',
    'LEG-1': 'LEG-1.json',
    'Ortega - OLL': 'Ortega-OLL.json',
    'Ortega - PLL': 'Ortega-PLL.json',
};

function escapeSwiftString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatMultiLineBody(algorithms: string[]): string {
    return algorithms.map((a) => `        "${escapeSwiftString(a)}"`).join(',\n') + '\n    ';
}

function formatSingleLineBody(algorithms: string[]): string {
    return '        ' + algorithms.map((a) => `"${escapeSwiftString(a)}"`).join(', ');
}

// Finds the index of the ']' matching the '[' at openIndex, by simple depth
// counting - safe here since none of the algorithm strings contain literal
// '[' or ']' (cube notation doesn't use square brackets).
function findMatchingBracket(text: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
        if (text[i] === '[') depth++;
        else if (text[i] === ']') {
            depth--;
            if (depth === 0) return i;
        }
    }
    throw new Error(`No matching ']' found for '[' at index ${openIndex}`);
}

function countStringLiterals(text: string): number {
    return (text.match(/"(?:[^"\\]|\\.)*"/g) ?? []).length;
}

function main(): void {
    const swiftPath = process.argv[2] ?? join(__dirname, '..', '..', 'AlgorithmData.swift');

    const source = readFileSync(swiftPath, 'utf-8');

    const algsetsMarker = 'var algsets = [';
    const algsetsMarkerIndex = source.indexOf(algsetsMarker);
    if (algsetsMarkerIndex === -1) {
        throw new Error(`Could not find "${algsetsMarker}" in ${swiftPath}`);
    }
    const algsetsOpen = algsetsMarkerIndex + algsetsMarker.length - 1; // index of the '['
    const algsetsClose = findMatchingBracket(source, algsetsOpen);

    let block = source.slice(algsetsOpen, algsetsClose + 1);

    const summary: { key: string; oldCount: number; newCount: number }[] = [];

    for (const [key, seedFile] of Object.entries(SET_KEY_TO_SEED_FILE)) {
        const { algorithms } = JSON.parse(readFileSync(join(SEED_DATA_DIR, seedFile), 'utf-8')) as { algorithms: string[] };

        const keyMarker = `"${key}": [`;
        const keyIndex = block.indexOf(keyMarker);
        if (keyIndex === -1) {
            throw new Error(`Could not find algsets entry '"${key}": [' in ${swiftPath}`);
        }
        const openBracket = keyIndex + keyMarker.length - 1;
        const closeBracket = findMatchingBracket(block, openBracket);

        const oldBody = block.slice(openBracket + 1, closeBracket);
        const inlineComment = /^(\/\/[^\n]*)/.exec(oldBody)?.[1] ?? '';
        const oldCount = countStringLiterals(oldBody);

        // Preserve each entry's original layout: some sets list one
        // algorithm per line, others cram the whole array onto a single
        // line after the comment. Detected by how many non-empty lines
        // follow the comment in the original.
        const restLines = oldBody
            .slice(inlineComment.length)
            .split('\n')
            .filter((l) => l.trim().length > 0);
        const wasMultiLine = restLines.length > 1;

        const newBody = wasMultiLine ? formatMultiLineBody(algorithms) : formatSingleLineBody(algorithms);
        const replacement = `${keyMarker}${inlineComment}\n${newBody}]`;
        block = block.slice(0, keyIndex) + replacement + block.slice(closeBracket + 1);

        summary.push({ key, oldCount, newCount: algorithms.length });
    }

    const newSource = source.slice(0, algsetsOpen) + block + source.slice(algsetsClose + 1);
    writeFileSync(swiftPath, newSource, 'utf-8');

    console.log(`Updated ${swiftPath}\n`);
    for (const { key, oldCount, newCount } of summary) {
        const flag = oldCount !== newCount ? `  <-- count changed (was ${oldCount})` : '';
        console.log(`  ${key}: ${newCount} algorithms${flag}`);
    }
}

main();
