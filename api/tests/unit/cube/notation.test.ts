import { normalizeNotation, invertNotation } from '../../../cube/notation';
import { expect, describe, it } from '@jest/globals';

describe('normalizeNotation', () => {
    it('trims leading/trailing whitespace', () => {
        expect(normalizeNotation("  R U R'  ")).toBe("R U R'");
    });

    it('collapses internal whitespace runs to a single space', () => {
        expect(normalizeNotation("R    U\tR'")).toBe("R U R'");
    });

    it('strips parentheses without gluing adjacent moves together', () => {
        expect(normalizeNotation("(R U R') U (R' F R F')")).toBe("R U R' U R' F R F'");
    });

    it('handles a stray unmatched paren gracefully', () => {
        expect(normalizeNotation("R U' M)")).toBe("R U' M");
    });
});

describe('invertNotation', () => {
    it('inverts a plain turn', () => {
        expect(invertNotation('R')).toBe("R'");
    });

    it('inverts a prime turn back to plain', () => {
        expect(invertNotation("R'")).toBe('R');
    });

    it('leaves a double turn unchanged (its own inverse)', () => {
        expect(invertNotation('R2')).toBe('R2');
    });

    it('inverts lowercase wide moves', () => {
        expect(invertNotation('r')).toBe("r'");
        expect(invertNotation("r'")).toBe('r');
        expect(invertNotation('r2')).toBe('r2');
    });

    it('inverts Xw-style wide moves', () => {
        expect(invertNotation('Rw')).toBe("Rw'");
        expect(invertNotation("Rw'")).toBe('Rw');
    });

    it('inverts 3-layer moves', () => {
        expect(invertNotation('3R')).toBe("3R'");
        expect(invertNotation("3R'")).toBe('3R');
    });

    it('inverts whole-cube rotations', () => {
        expect(invertNotation('x')).toBe("x'");
        expect(invertNotation('y2')).toBe('y2');
    });

    it('reverses move order in addition to inverting each move', () => {
        // Sune <-> Sune's inverse - the same pair used throughout the
        // NormalCube tests to represent an OLL scramble/solve.
        expect(invertNotation("R U R' U R U2 R'")).toBe("R U2 R' U' R U' R'");
        expect(invertNotation("R U2 R' U' R U' R'")).toBe("R U R' U R U2 R'");
    });

    it('normalizes (strips parens, collapses whitespace) before inverting', () => {
        expect(invertNotation("(R U R') U2  (R' U' R)")).toBe("R' U R U2 R U' R'");
    });

    it('round-trips: inverting twice returns the normalized original', () => {
        const original = "R U R' U R U2 R'";
        expect(invertNotation(invertNotation(original))).toBe(normalizeNotation(original));
    });
});
