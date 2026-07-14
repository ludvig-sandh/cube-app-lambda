// Verifies the *other* direction from verify-image-cases.ts: that the
// "scramble" seed-algorithm-sets.ts stores for each case (invertNotation of
// the case's solving algorithm, applied to a solved cube) actually reproduces
// the last-layer stickers shown in that case's reference image - not just
// that the algorithm solves it. A case can pass the "solves" check with a
// non-zero AUF tolerance (see verify-image-cases.ts) while its stored
// scramble, which has no such tolerance built in, still lands on a
// last-layer state that's some whole-cube U rotation away from the picture -
// this catches that.
//
// For each case: start a solved NormalCube, apply invertNotation(algorithm),
// then compare its last-layer cells directly against the colors read from
// the reference image (position by position, exact match - no isSolved()
// involved). Cells the set's mask ignores are skipped, matching the "we
// don't care what these end up as" policy used everywhere else. On mismatch,
// also checks whether 1-3 extra trailing U turns on the scramble would have
// matched, purely as a diagnostic to explain *why* it mismatched.
//
// Usage: npx ts-node scripts/verify-scramble-images.ts <dir> [imagePrefix]
// Same <dir>/imagePrefix contract as verify-image-cases.ts.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { NormalCube } from '../cube/NormalCube';
import { invertNotation } from '../cube/notation';
import { Side, SeedData, buildPositionMap, decodeCaseStickers, expectedStickerCount, findCaseImages, findSeedJson, parseCubeSize } from './lib/caseImages';

// All 24 whole-cube reorientations: 6 choices of which face points up
// (identity, or one x/z quarter/half-turn) times 4 choices of rotation
// around the resulting vertical axis.
const ALL_ROTATIONS: string[] = [];
for (const up of ['', 'x', 'x2', "x'", 'z', "z'"]) {
    for (const around of ['', 'y', 'y2', "y'"]) {
        ALL_ROTATIONS.push(`${up} ${around}`.trim());
    }
}

function isMasked(mask: string, x: number, y: number): boolean {
    const rows = mask.split('\n');
    return rows[y][x] === '.';
}

// Applies `notation` to a fresh solved cube and reads back the last-layer
// cells named in positionMap, keyed the same way decodeCaseStickers keys its
// result ("x,y") so the two can be compared directly.
function scrambleCellColors(notation: string, cubeSize: number, positionMap: Map<string, { x: number; y: number }>): Map<string, Side> {
    const cube = new NormalCube(cubeSize);
    cube.applyMoves(notation);
    const grid = (cube as unknown as { grid: Side[][] }).grid;
    const colors = new Map<string, Side>();
    for (const pos of positionMap.values()) {
        colors.set(`${pos.x},${pos.y}`, grid[pos.x][pos.y]);
    }
    return colors;
}

function main(): void {
    const dir = process.argv[2];
    if (!dir || !existsSync(dir)) {
        console.error('Usage: npx ts-node scripts/verify-scramble-images.ts <dir> [imagePrefix]');
        process.exit(1);
    }

    const { path: jsonPath, setId } = findSeedJson(dir);
    const { cubeType, mask, algorithms } = JSON.parse(readFileSync(jsonPath, 'utf-8')) as SeedData;
    const cubeSize = parseCubeSize(cubeType);

    const explicitPrefix = process.argv[3];
    const prefix = explicitPrefix ?? setId.replace(/[^a-zA-Z0-9]/g, '');

    const caseIdToFile = findCaseImages(dir, prefix);

    if (caseIdToFile.size !== algorithms.length) {
        console.error(
            `Found ${caseIdToFile.size} images matching prefix "${prefix}" but ${algorithms.length} algorithms in ${jsonPath}.` +
                ` Pass the correct imagePrefix as a second argument if "${prefix}" is wrong.`,
        );
        process.exit(1);
    }

    // label -> pos, plus the reverse for readable mismatch messages.
    const positionMap = buildPositionMap(cubeSize);
    const labelByKey = new Map<string, string>();
    for (const [label, pos] of positionMap) {
        labelByKey.set(`${pos.x},${pos.y}`, label);
    }

    const failures: { caseId: number; algorithm: string; imageFile: string; reason: string }[] = [];

    for (const [index, rawAlgorithm] of algorithms.entries()) {
        const caseId = index + 1;
        const imageFile = caseIdToFile.get(caseId)!;
        const imagePath = join(dir, imageFile);

        const decoded = decodeCaseStickers(imagePath, cubeSize, positionMap);
        if ('foundStickers' in decoded) {
            failures.push({
                caseId,
                algorithm: rawAlgorithm,
                imageFile,
                reason: `expected ${expectedStickerCount(cubeSize)} stickers in the last-layer view, found ${decoded.foundStickers}`,
            });
            continue;
        }
        const { cellColors: expected } = decoded;

        const scramble = invertNotation(rawAlgorithm);
        const actual = scrambleCellColors(scramble, cubeSize, positionMap);

        const mismatches: string[] = [];
        for (const [key, expectedColor] of expected) {
            const [x, y] = key.split(',').map(Number);
            if (isMasked(mask, x, y)) continue;
            const actualColor = actual.get(key);
            if (actualColor !== expectedColor) {
                mismatches.push(`${labelByKey.get(key) ?? key}: expected ${expectedColor}, got ${actualColor}`);
            }
        }

        if (mismatches.length === 0) {
            console.log(`Case ${caseId}: OK - scramble "${scramble}" reproduces ${imageFile}`);
            continue;
        }

        // Diagnostic only: does the mismatch go away with a whole-cube
        // reorientation applied to the solved cube *before* the scramble
        // (any of the 24 possible)? isSolved() itself is rotation-invariant,
        // so an algorithm can pass the "solves the picture" check in
        // verify-image-cases.ts while actually landing on a rotated version
        // of solved (s1 = R(canonicalSolved)) rather than canonical solved
        // itself - inverting then means s0 = A^-1(R(canonicalSolved)), i.e.
        // the rotation has to happen first, not be appended after A^-1.
        // Doesn't affect pass/fail - the stored scramble is applied as-is
        // with no such tolerance, so a real mismatch is a real mismatch.
        let matchingRotation: string | null = null;
        outer: for (const rotation of ALL_ROTATIONS) {
            for (let auf = 0; auf < 4; auf++) {
                const prefix = `${rotation} ${'U '.repeat(auf)}`.trim();
                const withRotation = scrambleCellColors(`${prefix} ${scramble}`.trim(), cubeSize, positionMap);
                const allMatch = [...expected].every(([key, expectedColor]) => {
                    const [x, y] = key.split(',').map(Number);
                    return isMasked(mask, x, y) || withRotation.get(key) === expectedColor;
                });
                if (allMatch) {
                    matchingRotation = prefix;
                    break outer;
                }
            }
        }

        const hint =
            matchingRotation !== null
                ? ` (matches after whole-cube rotation "${matchingRotation || '(none - only AUF differs)'}")`
                : ' (no whole-cube rotation reconciles it either - not just an orientation difference)';
        failures.push({
            caseId,
            algorithm: rawAlgorithm,
            imageFile,
            reason: `scramble "${scramble}" does not reproduce the image${hint} - mismatches: ${mismatches.join('; ')}`,
        });
    }

    console.log(`\n${algorithms.length - failures.length}/${algorithms.length} cases verified OK.`);
    if (failures.length > 0) {
        console.log(`\n${failures.length} failure(s):`);
        for (const f of failures) {
            console.log(`  Case ${f.caseId} (${f.imageFile}): "${f.algorithm}" - ${f.reason}`);
        }
        process.exitCode = 1;
    }
}

main();
