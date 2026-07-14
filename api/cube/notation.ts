export function normalizeNotation(notation: string): string {
    return notation
        .replace(/[()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function invertMove(move: string): string {
    if (move.endsWith("'")) {
        return move.slice(0, -1);
    }
    if (move.endsWith('2')) {
        return move;
    }
    return `${move}'`;
}

export function invertNotation(notation: string): string {
    return normalizeNotation(notation).split(' ').reverse().map(invertMove).join(' ');
}

// Per-cube-type whitelist of turn/rotation letters. A cube type absent from
// this map has no extra restrictions beyond what NormalCube itself can
// parse.
//
// 2x2: capital-letter face turns (R L F B U D) and whole-cube rotations
// (x y z) only. No lowercase face turns, no explicit wide turns (Rw etc - a
// 2x2 has no inner layer to make wide turns distinct from face turns
// anyway), and no slice moves (M E S - a 2x2 has no middle layer for them
// to turn).
const MOVE_LETTERS_BY_CUBE_TYPE: Record<string, ReadonlySet<string>> = {
    '2x2': new Set(['R', 'L', 'F', 'B', 'U', 'D', 'x', 'y', 'z']),
};

// A move is a letter followed by an optional modifier - order matters, not
// just which characters appear. Position 0 must be the turn/rotation
// letter. Everything after it must be exactly '', "'", '2', or "2'": a
// double turn may carry a trailing apostrophe (finger-trick hint - doesn't
// change which turn it is, so it's allowed), but an apostrophe may never
// come before a '2' ("R'2" is rejected even though "R2'" is accepted).
function hasValidMoveShape(move: string, letters: ReadonlySet<string>): boolean {
    const letter = move[0];
    if (letter === undefined || !letters.has(letter)) {
        return false;
    }
    const modifier = move.slice(1);
    return modifier === '' || modifier === "'" || modifier === '2' || modifier === "2'";
}

// Checks every move in an already-normalized notation string against this
// cube type's move whitelist and modifier ordering rules. Returns the first
// offending move, or null if the notation is entirely valid (or this cube
// type has no whitelist).
export function findInvalidMove(notation: string, cubeType: string): string | null {
    const letters = MOVE_LETTERS_BY_CUBE_TYPE[cubeType];
    if (!letters) {
        return null;
    }
    const moves = notation.split(' ').filter((move) => move.length > 0);
    return moves.find((move) => !hasValidMoveShape(move, letters)) ?? null;
}
