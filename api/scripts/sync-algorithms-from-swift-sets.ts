// Copies the (now corrected) algorithm lists out of the iOS app's
// per-set AlgorithmSets/*.swift files and overwrites the "algorithms"
// array in the matching seed-data/*.json file, preserving order.
// Only the "algorithms" field is touched - cubeType/mask are left as-is.
//
// Usage: npx ts-node scripts/sync-algorithms-from-swift-sets.ts [path-to-AlgorithmSets-dir]
// Defaults to the AlgorithmSets folder in "The Cube App Remastered" on the Desktop.

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SEED_DATA_DIR = join(__dirname, '..', '..', 'seed-data');

// Swift file name -> seed-data/*.json file name. Sets with no seed-data
// counterpart (e.g. FourLLLAlgorithmSet.swift / "4LLL") are omitted on purpose.
const SWIFT_FILE_TO_SEED_FILE: Record<string, string> = {
    'CLLAlgorithmSet.swift': 'CLL.json',
    'CMLLAlgorithmSet.swift': 'CMLL.json',
    'COLLAlgorithmSet.swift': 'COLL.json',
    'EG1AlgorithmSet.swift': 'EG-1.json',
    'EG2AlgorithmSet.swift': 'EG-2.json',
    'ELLAlgorithmSet.swift': 'ELL.json',
    'F2LAlgorithmSet.swift': 'F2L.json',
    'LEG1AlgorithmSet.swift': 'LEG-1.json',
    'OLLAlgorithmSet.swift': 'OLL.json',
    'OLLOneHandedAlgorithmSet.swift': 'OLL-OH.json',
    'OrtegaOLLAlgorithmSet.swift': 'Ortega-OLL.json',
    'OrtegaPLLAlgorithmSet.swift': 'Ortega-PLL.json',
    'PLLAlgorithmSet.swift': 'PLL.json',
    'PLLOneHandedAlgorithmSet.swift': 'PLL-OH.json',
    'VLSAlgorithmSet.swift': 'VLS.json',
    'WVAlgorithmSet.swift': 'WV.json',
    'ZBLLASAlgorithmSet.swift': 'ZBLL-AS.json',
    'ZBLLHAlgorithmSet.swift': 'ZBLL-H.json',
    'ZBLLLAlgorithmSet.swift': 'ZBLL-L.json',
    'ZBLLPiAlgorithmSet.swift': 'ZBLL-PI.json',
    'ZBLLSAlgorithmSet.swift': 'ZBLL-S.json',
    'ZBLLTAlgorithmSet.swift': 'ZBLL-T.json',
    'ZBLLUAlgorithmSet.swift': 'ZBLL-U.json',
};

const DEFAULT_SWIFT_DIR = join(
    '/Users/ludvigsandh/Desktop/src/The Cube App Remastered/The Cube App Remastered/Algorithms/AlgorithmSets',
);

function unescapeSwiftString(literal: string): string {
    // literal includes the surrounding quotes, e.g. "R U R'"
    const inner = literal.slice(1, -1);
    return inner.replace(/\\(.)/g, '$1');
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

function extractAlgorithmsFromSwift(swiftPath: string): string[] {
    const source = readFileSync(swiftPath, 'utf-8');
    const marker = 'algorithms: [';
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) {
        throw new Error(`Could not find "${marker}" in ${swiftPath}`);
    }
    const openBracket = markerIndex + marker.length - 1;
    const closeBracket = findMatchingBracket(source, openBracket);
    const body = source.slice(openBracket + 1, closeBracket);

    const literals = body.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    return literals.map(unescapeSwiftString);
}

function replaceAlgorithmsInJson(jsonPath: string, algorithms: string[]): number {
    const source = readFileSync(jsonPath, 'utf-8');
    const marker = '"algorithms": [';
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) {
        throw new Error(`Could not find '${marker}' in ${jsonPath}`);
    }
    const openBracket = markerIndex + marker.length - 1;
    const closeBracket = findMatchingBracket(source, openBracket);

    const oldBody = source.slice(openBracket + 1, closeBracket);
    const oldCount = (oldBody.match(/"(?:[^"\\]|\\.)*"/g) ?? []).length;

    const newBody = '\n' + algorithms.map((a) => `        ${JSON.stringify(a)}`).join(',\n') + '\n  ';
    const newSource = source.slice(0, openBracket + 1) + newBody + source.slice(closeBracket);
    writeFileSync(jsonPath, newSource, 'utf-8');

    return oldCount;
}

function main(): void {
    const swiftDir = process.argv[2] ?? DEFAULT_SWIFT_DIR;

    const filesInDir = new Set(readdirSync(swiftDir));

    const summary: { swiftFile: string; oldCount: number; newCount: number }[] = [];

    for (const [swiftFile, seedFile] of Object.entries(SWIFT_FILE_TO_SEED_FILE)) {
        if (!filesInDir.has(swiftFile)) {
            throw new Error(`Expected swift file not found in ${swiftDir}: ${swiftFile}`);
        }
        const algorithms = extractAlgorithmsFromSwift(join(swiftDir, swiftFile));
        const oldCount = replaceAlgorithmsInJson(join(SEED_DATA_DIR, seedFile), algorithms);
        summary.push({ swiftFile, oldCount, newCount: algorithms.length });
    }

    console.log(`Synced ${summary.length} algorithm sets from ${swiftDir}\n`);
    for (const { swiftFile, oldCount, newCount } of summary) {
        const flag = oldCount !== newCount ? `  <-- count changed (was ${oldCount})` : '';
        console.log(`  ${swiftFile}: ${newCount} algorithms${flag}`);
    }
}

main();
