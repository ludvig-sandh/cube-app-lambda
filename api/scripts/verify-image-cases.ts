// Verifies a not-yet-seeded algorithm set (e.g. toverify/ZBLL/ZBLL AS) by
// checking every algorithm against the reference image for its case, instead
// of against hand-typed scrambles. Each image is a 150x150 RGBA image (PNG
// bytes - some sets ship these with a ".gif" extension, but the content is
// still a PNG, so the same decoder handles both) showing a top-down view of
// the last layer: an NxN grid for U (N = cube size), plus one flap of N
// stickers on each side (N/S/E/W) showing the adjacent faces' top-layer row -
// the bottom layers aren't pictured because this image style only ever shows
// sets whose cases are fully determined by the last layer, so they're
// assumed solved.
//
// For each case: start a solved NormalCube, overwrite its N*(N+4) last-layer
// cells with the colors read from the image, apply the set's algorithm, then
// check isSolved() (respecting the set's ignore mask, and its own built-in
// trailing-AUF tolerance). A case is accepted if this holds for *some* 0-3
// extra U turns prepended before the algorithm too - on ZBLL AS this never
// ended up mattering (auf=0 always sufficed), but an algorithm author
// picking a different recognition angle than the reference image would be a
// legitimate reason for it to, so the tolerance is kept for future sets.
//
// See verify-scramble-images.ts for the inverse check (does the case's
// stored *scramble* reproduce the pictured case from solved).
//
// Usage: npx ts-node scripts/verify-image-cases.ts <dir> [imagePrefix]
// <dir> must contain exactly one *.json seed file (same shape as seed-data/*)
// and one image per case named "<imagePrefix><caseId>.png" or ".gif" (case 1
// first). imagePrefix defaults to the JSON file's basename (e.g.
// "ZBLL-AS.json" -> tries "ZBLL-AS1.png"; pass it explicitly when that
// doesn't match, e.g. "ZBLLAS", or "C" for a "CLL.json" paired with
// "C1.gif"..).
//
// Image color <-> face-name and image position <-> grid-cell calibration
// (in scripts/lib/caseImages.ts) was derived empirically against
// toverify/ZBLL/ZBLL AS (72 cases, all of which matched with zero mismatched
// stickers) and re-confirmed against toverify/CLL (2x2, 40 cases) - the
// grid/flap geometry scales cleanly with cube size, and the color palette
// carried over unchanged. If a new set's images use a visibly different
// layout or palette, re-run that calibration rather than assuming this still
// applies.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { NormalCube } from '../cube/NormalCube';
import { normalizeNotation } from '../cube/notation';
import { Side, SeedData, buildPositionMap, decodeCaseStickers, expectedStickerCount, findCaseImages, findSeedJson, parseCubeSize } from './lib/caseImages';

function main(): void {
    const dir = process.argv[2];
    if (!dir || !existsSync(dir)) {
        console.error('Usage: npx ts-node scripts/verify-image-cases.ts <dir> [imagePrefix]');
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

    const positionMap = buildPositionMap(cubeSize);
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
        const { cellColors } = decoded;

        const normalizedAlg = normalizeNotation(rawAlgorithm);

        // Try 0-3 extra U turns before the algorithm - see file header on why
        // this tolerance is needed and why it doesn't hide real bugs.
        let solvedWithAuf: number | null = null;
        for (let auf = 0; auf < 4; auf++) {
            const cube = new NormalCube(cubeSize);
            const grid = (cube as unknown as { grid: Side[][] }).grid;
            for (const [key, face] of cellColors) {
                const [x, y] = key.split(',').map(Number);
                grid[x][y] = face;
            }
            for (let t = 0; t < auf; t++) {
                cube.applyTurn('U');
            }
            cube.applyMoves(normalizedAlg);
            cube.applyIgnoreMask(mask);
            if (cube.isSolved()) {
                solvedWithAuf = auf;
                break;
            }
        }

        if (solvedWithAuf === null) {
            failures.push({
                caseId,
                algorithm: rawAlgorithm,
                imageFile,
                reason: 'algorithm does not solve the case shown in the image (tried 0-3 pre-turns of U)',
            });
        } else {
            console.log(`Case ${caseId}: OK (auf=${solvedWithAuf}) - "${rawAlgorithm}"`);
        }
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
