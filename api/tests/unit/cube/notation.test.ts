import { normalizeNotation, cleanNotation, findParenError, invertNotation, findInvalidMove } from '../../../cube/notation';
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

describe('cleanNotation', () => {
    it('trims leading/trailing whitespace', () => {
        expect(cleanNotation("  R U R'  ")).toBe("R U R'");
    });

    it('collapses internal whitespace runs to a single space', () => {
        expect(cleanNotation("R    U\tR'")).toBe("R U R'");
    });

    it('keeps parentheses intact', () => {
        expect(cleanNotation("(R U R') U (R' F R F')")).toBe("(R U R') U (R' F R F')");
    });
});

describe('findParenError', () => {
    it('accepts notation with no parentheses', () => {
        expect(findParenError("R U R' U'")).toBeNull();
    });

    it('accepts a single balanced group hugging its moves', () => {
        expect(findParenError("(R U R' U')")).toBeNull();
    });

    it('accepts multiple balanced groups separated by whitespace', () => {
        expect(findParenError("(R U R') U (R' F R F')")).toBeNull();
    });

    it('accepts a group with internal spacing', () => {
        expect(findParenError("( R U R' )")).toBeNull();
    });

    it('rejects an unmatched opening paren', () => {
        expect(findParenError("(R U R' U'")).toBe('Unmatched "(" in notation.');
    });

    it('rejects an unmatched closing paren', () => {
        expect(findParenError("R U R' U')")).toBe('Unmatched ")" in notation.');
    });

    it('rejects nested parentheses', () => {
        expect(findParenError("(R U (R' U'))")).toBe('Nested parentheses are not supported.');
    });

    it('rejects a paren glued to a move without a boundary', () => {
        expect(findParenError("R(U)R' U'")).toBe('Parentheses must wrap whole moves, not partial moves.');
    });

    it('rejects adjacent groups glued together with no separating space', () => {
        expect(findParenError("(R U)(R' U')")).toBe('Parentheses must wrap whole moves, not partial moves.');
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

describe('findInvalidMove', () => {
    describe('2x2', () => {
        it('accepts capital-letter face turns with no modifier, prime, or double', () => {
            expect(findInvalidMove("R U R' U2 F D'", '2x2')).toBeNull();
        });

        it('accepts whole-cube rotations', () => {
            expect(findInvalidMove("x y' z2", '2x2')).toBeNull();
        });

        it('rejects lowercase wide-style face turns', () => {
            expect(findInvalidMove("R U r'", '2x2')).toBe("r'");
        });

        it('rejects explicit Xw-style wide turns', () => {
            expect(findInvalidMove('Rw U', '2x2')).toBe('Rw');
        });

        it('rejects slice moves', () => {
            expect(findInvalidMove('M U E', '2x2')).toBe('M');
        });

        it('rejects 3-layer-prefixed moves', () => {
            expect(findInvalidMove('3R U', '2x2')).toBe('3R');
        });

        it('accepts a double turn with a trailing apostrophe (finger-trick hint)', () => {
            expect(findInvalidMove("R2' U", '2x2')).toBeNull();
        });

        it('rejects an apostrophe before the 2 (wrong modifier order)', () => {
            expect(findInvalidMove("R'2 U", '2x2')).toBe("R'2");
        });

        it('rejects a doubled modifier', () => {
            expect(findInvalidMove("R'' U", '2x2')).toBe("R''");
            expect(findInvalidMove('R22 U', '2x2')).toBe('R22');
        });

        it('rejects a modifier with no letter', () => {
            expect(findInvalidMove("' U", '2x2')).toBe("'");
        });

        it('rejects two turns glued into a single component', () => {
            expect(findInvalidMove('RL U', '2x2')).toBe('RL');
        });
    });

    describe('3x3', () => {
        it('accepts everything 2x2 accepts', () => {
            expect(findInvalidMove("R U R' U2 F D' x y' z2", '3x3')).toBeNull();
        });

        it('accepts lowercase wide face turns', () => {
            expect(findInvalidMove("r u f' l2 d b2'", '3x3')).toBeNull();
        });

        it('accepts slice moves', () => {
            expect(findInvalidMove("M E' S2", '3x3')).toBeNull();
        });

        it('rejects explicit Xw-style wide turns', () => {
            expect(findInvalidMove('Rw U', '3x3')).toBe('Rw');
        });

        it('rejects 3-layer-prefixed moves', () => {
            expect(findInvalidMove('3R U', '3x3')).toBe('3R');
        });

        it('rejects an apostrophe before the 2, including on lowercase moves', () => {
            expect(findInvalidMove("R'2 U", '3x3')).toBe("R'2");
            expect(findInvalidMove("r'2 U", '3x3')).toBe("r'2");
        });

        it('accepts a double turn with a trailing apostrophe on a lowercase move', () => {
            expect(findInvalidMove("r2' U", '3x3')).toBeNull();
        });

        it('rejects two turns glued into a single component', () => {
            expect(findInvalidMove('RL U', '3x3')).toBe('RL');
        });
    });

    it('has no whitelist for other cube types', () => {
        expect(findInvalidMove("R U r' M Rw anything goes here", '4x4')).toBeNull();
    });
});
