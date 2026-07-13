import { NormalCube } from '../../../cube/NormalCube';
import { expect, describe, it } from '@jest/globals';

describe('NormalCube', () => {
    it('is solved right after construction', () => {
        const cube = new NormalCube(3);
        expect(cube.isSolved()).toBe(true);
    });

    it.each(['R', 'L', 'F', 'B', 'U', 'D'])('returns to the exact initial state after four %s turns', (letter) => {
        const cube = new NormalCube(3);
        cube.applyMoves(`${letter} ${letter} ${letter} ${letter}`);
        expect(cube.equals(new NormalCube(3))).toBe(true);
    });

    it('is not solved after a single turn', () => {
        const cube = new NormalCube(3);
        cube.applyMoves('R');
        expect(cube.isSolved()).toBe(false);
    });

    it('undoes a sequence of turns with its exact inverse', () => {
        const cube = new NormalCube(3);
        cube.applyMoves("R U F' L2 B D'");
        cube.applyMoves("D B' L2 F U' R'");
        expect(cube.equals(new NormalCube(3))).toBe(true);
    });

    it('returns to the exact initial state after six repetitions of "R U R\' U\'"', () => {
        const cube = new NormalCube(3);
        for (let i = 0; i < 6; i++) {
            cube.applyMoves("R U R' U'");
        }
        expect(cube.equals(new NormalCube(3))).toBe(true);
    });

    it.each(['r', 'l', 'f', 'b', 'u', 'd'])(
        'returns to the exact initial state after four %s turns (lowercase wide-move notation)',
        (letter) => {
            const cube = new NormalCube(3);
            cube.applyMoves(`${letter} ${letter} ${letter} ${letter}`);
            expect(cube.equals(new NormalCube(3))).toBe(true);
        },
    );

    it('a single lowercase wide move is not a no-op', () => {
        const cube = new NormalCube(3);
        cube.applyMoves('r');
        expect(cube.equals(new NormalCube(3))).toBe(false);
    });

    it.each(['M', 'E', 'S'])('returns to the exact initial state after four %s turns', (letter) => {
        const cube = new NormalCube(3);
        cube.applyMoves(`${letter} ${letter} ${letter} ${letter}`);
        expect(cube.equals(new NormalCube(3))).toBe(true);
    });

    it('a single slice move is not a no-op', () => {
        const cube = new NormalCube(3);
        cube.applyMoves('M');
        expect(cube.equals(new NormalCube(3))).toBe(false);
    });

    // Pins down slice-move direction against the standard identities
    // (rather than just checking "4 turns return to solved", which passes
    // regardless of direction).
    it.each([
        ['x', "R M' L'"],
        ['y', "U E' D'"],
        ['z', "F S B'"],
    ])('%s equals "%s"', (rotation, equivalent) => {
        const rotated = new NormalCube(3);
        rotated.applyMoves(rotation);
        const composed = new NormalCube(3);
        composed.applyMoves(equivalent);
        expect(rotated.equals(composed)).toBe(true);
    });

    it('supports wide moves on larger cubes', () => {
        const cube = new NormalCube(4);
        cube.applyMoves('Rw Rw Rw Rw');
        expect(cube.equals(new NormalCube(4))).toBe(true);
    });

    it('supports 3-layer-deep moves on larger cubes', () => {
        const cube = new NormalCube(5);
        cube.applyMoves('3U 3U 3U 3U');
        expect(cube.equals(new NormalCube(5))).toBe(true);
    });

    // Unlike the tests above, this one genuinely relies on the
    // orientation-tolerant isSolved(): 3R on a 6-cube turns every layer, and
    // 3L' turns the remaining 3 in the same rotational sense, so together
    // they amount to a whole-cube x rotation - solved, but NOT equal to a
    // fresh cube (the labels have moved to different faces).
    it('two opposite wide moves results only in a rotation', () => {
        const cube = new NormalCube(6);
        cube.applyMoves("3R 3L'");
        expect(cube.isSolved()).toBe(true);
        expect(cube.equals(new NormalCube(6))).toBe(false);
    });

    it('clone is independent from the original', () => {
        const cube = new NormalCube(3);
        const clone = cube.clone();
        clone.applyMoves('R');
        expect(cube.isSolved()).toBe(true);
        expect(clone.isSolved()).toBe(false);
    });
});

describe('NormalCube rotations (x, y, z)', () => {
    // Rotations are whole-cube moves, so their effect can't be observed via
    // isSolved() alone once a face's own sticker pattern is at stake (a
    // solved face looks uniform no matter how its 3x3 pattern is internally
    // rotated). These tests peek at the private grid to check specific
    // facelets land where the rotation should put them.
    const cell = (cube: NormalCube, x: number, y: number): string =>
        (cube as unknown as { grid: string[][] }).grid[x][y];

    it.each(['x', 'y', 'z'])('returns to the exact initial state after four %s rotations', (letter) => {
        const cube = new NormalCube(3);
        cube.applyMoves(`${letter} ${letter} ${letter} ${letter}`);
        expect(cube.equals(new NormalCube(3))).toBe(true);
    });

    it.each(['x', 'y', 'z'])('is still solved after a single %s rotation (orientation-independent)', (letter) => {
        const cube = new NormalCube(3);
        cube.applyMoves(letter);
        expect(cube.isSolved()).toBe(true);
    });

    it('undoes a rotation with its exact inverse', () => {
        const cube = new NormalCube(3);
        cube.applyMoves("x y' z2");
        cube.applyMoves("z2 y x'");
        expect(cube.equals(new NormalCube(3))).toBe(true);
    });

    it('cycles whole faces top->back->bottom->front, and spins the L face, on x', () => {
        const cube = new NormalCube(3);
        // U moves front's top edge onto left's top row, giving the L face a
        // non-uniform marker to track through the rotation.
        cube.applyMoves('U x');
        expect(cell(cube, 0, 4)).toBe('front'); // marker rotated to L's middle-left
        expect(cell(cube, 2, 4)).toBe('left'); // untouched by the marker
    });

    it('cycles whole faces front->left->back->right, and spins the D face, on y', () => {
        const cube = new NormalCube(3);
        // F moves right's edge onto bottom's front-facing row, marking D.
        cube.applyMoves('F y');
        expect(cell(cube, 3, 7)).toBe('right'); // marker rotated to D's middle-left
        expect(cell(cube, 5, 7)).toBe('bottom'); // untouched by the marker
    });

    it('cycles whole faces top->right->bottom->left, and spins the B face, on z', () => {
        const cube = new NormalCube(3);
        // U moves left's edge onto back's top row, marking B.
        cube.applyMoves('U z');
        expect(cell(cube, 9, 4)).toBe('left'); // marker rotated to B's middle-left
        expect(cell(cube, 11, 4)).toBe('back'); // untouched by the marker
    });
});

describe('NormalCube.isSolved()', () => {
    // Directly poke the private grid to set up states that aren't reachable
    // through applyMoves() alone (e.g. a face partially marked "don't care").
    const setCell = (cube: NormalCube, x: number, y: number, value: string): void => {
        (cube as unknown as { grid: string[][] }).grid[x][y] = value;
    };

    it('is solved when a face has "none" cells alongside its one real color', () => {
        const cube = new NormalCube(3);
        setCell(cube, 3, 3, 'none'); // a front-face piece marked as don't-care
        expect(cube.isSolved()).toBe(true);
    });

    it('is not solved when a face has two different real colors, even with "none" cells present', () => {
        const cube = new NormalCube(3);
        setCell(cube, 3, 3, 'none'); // don't-care piece on the front face
        setCell(cube, 4, 3, 'top'); // a genuinely wrong color on the front face
        expect(cube.isSolved()).toBe(false);
    });

    it('is solved when an entire face is "none"', () => {
        const cube = new NormalCube(3);
        for (let x = 3; x <= 5; x++) {
            for (let y = 3; y <= 5; y++) {
                setCell(cube, x, y, 'none');
            }
        }
        expect(cube.isSolved()).toBe(true);
    });
});

describe('NormalCube.applyIgnoreMask()', () => {
    const cell = (cube: NormalCube, x: number, y: number): string =>
        (cube as unknown as { grid: string[][] }).grid[x][y];

    it('blanks only the masked cells to none, leaving the rest untouched', () => {
        const cube = new NormalCube(3);
        const width = 12; // size(3) * 4
        const rows = Array.from({ length: 9 }, () => '#'.repeat(width)); // size(3) * 3
        rows[3] = '.'.repeat(width); // last-layer belt row
        cube.applyIgnoreMask(rows.join('\n'));

        expect(cell(cube, 4, 3)).toBe('none'); // in the masked row
        expect(cell(cube, 4, 4)).toBe('front'); // outside the masked row, untouched
    });
});

describe('OLL-style case validation (mask applied fresh on every request)', () => {
    // Nothing is precomputed or stored as a derived cube state: the DB just
    // holds an algorithm set's mask (which cells it doesn't care about) and
    // a case's scramble notation (plain moves). The Lambda builds the
    // actual starting cube on every request: new cube -> applyIgnoreMask ->
    // applyMoves(scramble). The wildcards ride along with whatever the
    // scramble does to those cells since applyMoves() just permutes grid
    // cells regardless of content - so plain isSolved() (which already
    // treats 'none' as "don't care") is all validation ever needs.
    const OLL_MASK = (() => {
        const width = 12; // size(3) * 4
        const rows = Array.from({ length: 9 }, () => '#'.repeat(width)); // size(3) * 3
        rows[3] = '.'.repeat(width); // last-layer belt row: don't care
        return rows.join('\n');
    })();

    const buildCase = (scramble: string): NormalCube => {
        const cube = new NormalCube(3);
        cube.applyIgnoreMask(OLL_MASK);
        cube.applyMoves(scramble);
        return cube;
    };

    it('is unsolved right after scrambling', () => {
        const cube = buildCase("R U2 R' U' R U' R'"); // Sune's inverse
        expect(cube.isSolved()).toBe(false);
    });

    it('is solved once the matching algorithm is applied', () => {
        const cube = buildCase("R U2 R' U' R U' R'"); // Sune's inverse
        cube.applyMoves("R U R' U R U2 R'"); // Sune
        expect(cube.isSolved()).toBe(true);
    });

    it('stays unsolved if F2L gets disturbed along the way', () => {
        const cube = buildCase("R U2 R' U' R U' R'");
        cube.applyMoves('R'); // wrong move, disturbs F2L
        expect(cube.isSolved()).toBe(false);
    });
});
