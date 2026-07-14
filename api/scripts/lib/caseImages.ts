// Shared PNG decoding + last-layer-image calibration used by both
// verify-image-cases.ts (algorithm solves the pictured case) and
// verify-scramble-images.ts (inverse algorithm reproduces the pictured case
// from solved). See verify-image-cases.ts's file header for the calibration
// notes - this module just holds the parts both scripts need.

import { readdirSync, readFileSync } from 'fs';
import { inflateSync } from 'zlib';
import { join, basename } from 'path';

export type Side = 'top' | 'left' | 'front' | 'right' | 'back' | 'bottom' | 'none';

export interface DecodedPng {
    width: number;
    height: number;
    // RGBA, 4 bytes per pixel, row-major
    data: Uint8Array;
}

export function decodePng(buffer: Buffer): DecodedPng {
    if (buffer.readUInt32BE(0) !== 0x89504e47) {
        throw new Error('Not a PNG file (bad signature)');
    }
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatChunks: Buffer[] = [];

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const dataStart = offset + 8;
        const data = buffer.subarray(dataStart, dataStart + length);

        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data.readUInt8(8);
            colorType = data.readUInt8(9);
        } else if (type === 'IDAT') {
            idatChunks.push(Buffer.from(data));
        } else if (type === 'IEND') {
            break;
        }

        offset = dataStart + length + 4; // skip CRC
    }

    if (bitDepth !== 8 || colorType !== 6) {
        throw new Error(`Unsupported PNG format (bitDepth=${bitDepth}, colorType=${colorType}); expected 8-bit RGBA`);
    }

    const raw = inflateSync(Buffer.concat(idatChunks));
    const bytesPerPixel = 4;
    const stride = width * bytesPerPixel;
    const out = new Uint8Array(width * height * bytesPerPixel);

    let rawOffset = 0;
    for (let y = 0; y < height; y++) {
        const filterType = raw[rawOffset];
        rawOffset += 1;
        const rowStart = y * stride;
        const prevRowStart = (y - 1) * stride;
        for (let i = 0; i < stride; i++) {
            const x = raw[rawOffset + i];
            const a = i >= bytesPerPixel ? out[rowStart + i - bytesPerPixel] : 0;
            const b = y > 0 ? out[prevRowStart + i] : 0;
            const c = y > 0 && i >= bytesPerPixel ? out[prevRowStart + i - bytesPerPixel] : 0;
            let value: number;
            switch (filterType) {
                case 0:
                    value = x;
                    break;
                case 1:
                    value = x + a;
                    break;
                case 2:
                    value = x + b;
                    break;
                case 3:
                    value = x + Math.floor((a + b) / 2);
                    break;
                case 4: {
                    const p = a + b - c;
                    const pa = Math.abs(p - a);
                    const pb = Math.abs(p - b);
                    const pc = Math.abs(p - c);
                    const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                    value = x + pr;
                    break;
                }
                default:
                    throw new Error(`Unsupported PNG filter type ${filterType}`);
            }
            out[rowStart + i] = value & 0xff;
        }
        rawOffset += stride;
    }

    return { width, height, data: out };
}

interface Blob {
    cx: number;
    cy: number;
    size: number;
    avg: [number, number, number];
}

function isBackground(r: number, g: number, b: number, a: number): boolean {
    if (a < 50) return true;
    if (r < 40 && g < 40 && b < 40) return true;
    return false;
}

// Flood-fills the non-background stickers into connected blobs - robust to
// small rendering/anti-aliasing differences across images without needing
// hardcoded pixel coordinates.
function findBlobs(png: DecodedPng): Blob[] {
    const { width, height, data } = png;
    const visited = new Uint8Array(width * height);
    const blobs: Blob[] = [];
    const pixelAt = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const;
    };

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (visited[idx]) continue;
            const [r, g, b, a] = pixelAt(x, y);
            if (isBackground(r, g, b, a)) {
                visited[idx] = 1;
                continue;
            }
            const queue: [number, number][] = [[x, y]];
            visited[idx] = 1;
            const pixels: [number, number][] = [];
            let sumR = 0;
            let sumG = 0;
            let sumB = 0;
            while (queue.length > 0) {
                const [cx, cy] = queue.pop()!;
                pixels.push([cx, cy]);
                const [pr, pg, pb] = pixelAt(cx, cy);
                sumR += pr;
                sumG += pg;
                sumB += pb;
                for (const [dx, dy] of [
                    [-1, 0],
                    [1, 0],
                    [0, -1],
                    [0, 1],
                ]) {
                    const nx = cx + dx;
                    const ny = cy + dy;
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                    const nIdx = ny * width + nx;
                    if (visited[nIdx]) continue;
                    const [nr, ng, nb, na] = pixelAt(nx, ny);
                    if (isBackground(nr, ng, nb, na)) {
                        visited[nIdx] = 1;
                        continue;
                    }
                    visited[nIdx] = 1;
                    queue.push([nx, ny]);
                }
            }
            if (pixels.length > 15) {
                const cx = pixels.reduce((s, p) => s + p[0], 0) / pixels.length;
                const cy = pixels.reduce((s, p) => s + p[1], 0) / pixels.length;
                blobs.push({
                    cx,
                    cy,
                    size: pixels.length,
                    avg: [Math.round(sumR / pixels.length), Math.round(sumG / pixels.length), Math.round(sumB / pixels.length)],
                });
            }
        }
    }
    return blobs;
}

// Buckets a blob centroid into one of (cubeSize + 2) grid rows/cols by
// position fraction across the image - the 4 corner buckets are never
// populated since the reference image cuts those corners off. E.g.
// cubeSize=3 -> 5 buckets (0-4, U is 1-3); cubeSize=2 -> 4 buckets (0-3, U is
// 1-2).
function bucket(v: number, imageSize: number, cubeSize: number): number {
    const numBuckets = cubeSize + 2;
    const frac = v / imageSize;
    const b = Math.floor(frac * numBuckets);
    return Math.min(numBuckets - 1, Math.max(0, b));
}

function labelFor(row: number, col: number, cubeSize: number): string {
    const last = cubeSize + 1;
    if (row === 0) return `N${col - 1}`;
    if (row === last) return `S${col - 1}`;
    if (col === 0) return `W${row - 1}`;
    if (col === last) return `E${row - 1}`;
    return `U${row - 1}${col - 1}`;
}

// --- Calibration (derived empirically - see verify-image-cases.ts header) ---

// Which face each image flap shows, and whether its cells (in image reading
// order: N/S left-to-right, E/W top-to-bottom) need reversing to land in
// increasing-x grid order.
const FLAP_TO_FACE: Record<string, { face: 'front' | 'right' | 'back' | 'left'; reversed: boolean }> = {
    N: { face: 'back', reversed: true },
    S: { face: 'front', reversed: false },
    E: { face: 'right', reversed: true },
    W: { face: 'left', reversed: false },
};

// Each side face occupies a cubeSize-wide block of columns in the
// NormalCube grid, in left/front/right/back order (see NormalCube's net
// layout comment).
function sideXs(face: 'front' | 'right' | 'back' | 'left', cubeSize: number): number[] {
    const blockStart: Record<'left' | 'front' | 'right' | 'back', number> = {
        left: 0,
        front: cubeSize,
        right: cubeSize * 2,
        back: cubeSize * 3,
    };
    const start = blockStart[face];
    return Array.from({ length: cubeSize }, (_, i) => start + i);
}

// image_label -> NormalCube grid (x,y). U-face reads directly (no
// rotation/mirroring needed relative to the flap assignment above).
export function buildPositionMap(cubeSize: number): Map<string, { x: number; y: number }> {
    const map = new Map<string, { x: number; y: number }>();
    for (const flap of ['N', 'S', 'E', 'W'] as const) {
        const { face, reversed } = FLAP_TO_FACE[flap];
        const xs = sideXs(face, cubeSize);
        for (let i = 0; i < cubeSize; i++) {
            const xi = reversed ? xs[cubeSize - 1 - i] : xs[i];
            map.set(`${flap}${i}`, { x: xi, y: cubeSize });
        }
    }
    for (let r = 0; r < cubeSize; r++) {
        for (let c = 0; c < cubeSize; c++) {
            map.set(`U${r}${c}`, { x: cubeSize + c, y: r });
        }
    }
    return map;
}

// Reference sticker colors, one per last-layer-visible face name (never
// 'bottom' - see verify-image-cases.ts header). Values are the averages
// observed across all 72 ZBLL AS images.
const COLOR_REFERENCE: { face: Side; rgb: [number, number, number] }[] = [
    { face: 'top', rgb: [235, 235, 0] }, // yellow
    { face: 'front', rgb: [0, 0, 222] }, // blue
    { face: 'back', rgb: [0, 197, 0] }, // green
    { face: 'right', rgb: [219, 0, 0] }, // red
    { face: 'left', rgb: [233, 148, 0] }, // orange
];

function nearestFace(rgb: [number, number, number]): Side {
    let best: Side = 'top';
    let bestDist = Infinity;
    for (const ref of COLOR_REFERENCE) {
        const dist = (rgb[0] - ref.rgb[0]) ** 2 + (rgb[1] - ref.rgb[1]) ** 2 + (rgb[2] - ref.rgb[2]) ** 2;
        if (dist < bestDist) {
            bestDist = dist;
            best = ref.face;
        }
    }
    return best;
}

export function expectedStickerCount(cubeSize: number): number {
    return cubeSize * (cubeSize + 4);
}

// Decodes one case image into its last-layer NormalCube-grid colors, keyed
// "x,y" (matching how callers index into a NormalCube's private grid).
// Returns the raw blob count instead when it doesn't match what a clean
// image should have, so callers can report that as a failure.
export function decodeCaseStickers(
    imagePath: string,
    cubeSize: number,
    positionMap: Map<string, { x: number; y: number }>,
): { cellColors: Map<string, Side> } | { foundStickers: number } {
    const png = decodePng(readFileSync(imagePath));
    const blobs = findBlobs(png);
    if (blobs.length !== expectedStickerCount(cubeSize)) {
        return { foundStickers: blobs.length };
    }

    const cellColors = new Map<string, Side>();
    for (const blob of blobs) {
        const row = bucket(blob.cy, png.height, cubeSize);
        const col = bucket(blob.cx, png.width, cubeSize);
        const label = labelFor(row, col, cubeSize);
        const pos = positionMap.get(label);
        if (!pos) {
            throw new Error(`No calibrated position for image label "${label}" (${imagePath})`);
        }
        cellColors.set(`${pos.x},${pos.y}`, nearestFace(blob.avg));
    }
    return { cellColors };
}

export interface SeedData {
    cubeType: string;
    mask: string;
    algorithms: string[];
}

export function findSeedJson(dir: string): { path: string; setId: string } {
    const jsonFiles = readdirSync(dir).filter((f) => f.endsWith('.json'));
    if (jsonFiles.length !== 1) {
        throw new Error(`Expected exactly one .json file in ${dir}, found ${jsonFiles.length}: ${jsonFiles.join(', ')}`);
    }
    const file = jsonFiles[0];
    return { path: join(dir, file), setId: basename(file, '.json') };
}

// Case images are PNG-encoded regardless of extension - some sets ship
// theirs as ".gif" (misnamed, not actually GIF-encoded), so both are
// accepted here and decoded with the same PNG decoder.
export const IMAGE_EXTENSIONS = ['.png', '.gif'];

export function findCaseImages(dir: string, prefix: string): Map<number, string> {
    const imageFiles = readdirSync(dir).filter((f) => IMAGE_EXTENSIONS.some((e) => f.endsWith(e)));
    const caseIdToFile = new Map<number, string>();
    for (const f of imageFiles) {
        const caseId = extractCaseId(f, prefix);
        if (caseId !== null) caseIdToFile.set(caseId, f);
    }
    return caseIdToFile;
}

function extractCaseId(fileName: string, prefix: string): number | null {
    if (!fileName.startsWith(prefix)) return null;
    const ext = IMAGE_EXTENSIONS.find((e) => fileName.endsWith(e));
    if (!ext) return null;
    const numPart = fileName.slice(prefix.length, -ext.length);
    if (!/^\d+$/.test(numPart)) return null;
    return parseInt(numPart, 10);
}

export function parseCubeSize(cubeType: string): number {
    const match = /^(\d+)x\d+$/.exec(cubeType);
    if (!match) {
        throw new Error(`Unrecognized cubeType "${cubeType}" (expected e.g. "3x3" or "2x2")`);
    }
    return parseInt(match[1], 10);
}
