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

interface CubeMoveGrammar {
    // Letters a move may start with.
    letters: ReadonlySet<string>;
    // Face letters (a subset of `letters`) that may be followed by a 'w'
    // for an explicit wide turn (e.g. "Rw"). Orientation moves (x y z),
    // slice moves (M E S), and lowercase moves never take a 'w' suffix.
    wideLetters?: ReadonlySet<string>;
}

const FACE_SLICE_AND_ROTATION_LETTERS = new Set([
    'R',
    'L',
    'F',
    'B',
    'U',
    'D',
    'M',
    'E',
    'S',
    'x',
    'y',
    'z',
    'r',
    'l',
    'f',
    'b',
    'u',
    'd',
]);
const WIDE_CAPABLE_FACE_LETTERS = new Set(['R', 'L', 'F', 'B', 'U', 'D']);

// Per-cube-type move grammar. A cube type absent from this map has no extra
// restrictions beyond what NormalCube itself can parse.
//
// 2x2: capital-letter face turns (R L F B U D) and whole-cube rotations
// (x y z) only. No lowercase face turns, no explicit wide turns (Rw etc - a
// 2x2 has no inner layer to make wide turns distinct from face turns
// anyway), and no slice moves (M E S - a 2x2 has no middle layer for them
// to turn).
//
// 3x3: everything 2x2 allows, plus slice moves (M E S) and lowercase wide
// face turns (r l f b u d) - a 3x3 has the extra layers for both. Still no
// explicit Xw-style wide turns or 3-layer prefixes (3R): those aren't
// single letter+modifier moves, so hasValidMoveShape() rejects them the
// same way it rejects a two-turn component like "RL".
//
// 4x4: everything 3x3 allows, plus explicit wide turns (Rw etc) on capital
// face letters only - not on rotations ("xw") or slices ("Mw"), and not as
// a substitute for the lowercase moves (no "rw"). Lowercase face letters
// keep meaning something different here than on a 3x3: NormalCube treats
// them as a slice-only turn (just the layer adjacent to that face, no face
// rotation) rather than a wide turn - see NormalCube.getTurnFn(). That's a
// cube-simulation distinction, not a notation-shape one, so it doesn't
// change this grammar.
//
// 5x5: the same notation shape as 4x4 (same letters, same wide-turn
// eligibility) - a 5x5 has a genuine single center layer, so M E S keep
// meaning exactly that innermost layer (NormalCube.M/E/S already use
// Math.floor(size / 2), which lands on it), rather than needing a grammar
// change here.
const MOVE_GRAMMAR_BY_CUBE_TYPE: Record<string, CubeMoveGrammar> = {
    '2x2': { letters: new Set(['R', 'L', 'F', 'B', 'U', 'D', 'x', 'y', 'z']) },
    '3x3': { letters: FACE_SLICE_AND_ROTATION_LETTERS },
    '4x4': { letters: FACE_SLICE_AND_ROTATION_LETTERS, wideLetters: WIDE_CAPABLE_FACE_LETTERS },
    '5x5': { letters: FACE_SLICE_AND_ROTATION_LETTERS, wideLetters: WIDE_CAPABLE_FACE_LETTERS },
};

// A move is a letter, an optional 'w' (wide turn), then an optional
// modifier - order matters, not just which characters appear. Position 0
// must be the turn/rotation letter. A 'w' may only follow a letter this
// cube type allows wide turns on. Whatever remains after that must be
// exactly '', "'", '2', or "2'": a double turn may carry a trailing
// apostrophe (finger-trick hint - doesn't change which turn it is, so it's
// allowed), but an apostrophe may never come before a '2' ("R'2" is
// rejected even though "R2'" is accepted).
function hasValidMoveShape(move: string, grammar: CubeMoveGrammar): boolean {
    const letter = move[0];
    if (letter === undefined || !grammar.letters.has(letter)) {
        return false;
    }
    let modifier = move.slice(1);
    if (modifier.startsWith('w')) {
        if (!grammar.wideLetters?.has(letter)) {
            return false;
        }
        modifier = modifier.slice(1);
    }
    return modifier === '' || modifier === "'" || modifier === '2' || modifier === "2'";
}

// Checks every move in an already-normalized notation string against this
// cube type's move grammar. Returns the first offending move, or null if
// the notation is entirely valid (or this cube type has no grammar).
export function findInvalidMove(notation: string, cubeType: string): string | null {
    const grammar = MOVE_GRAMMAR_BY_CUBE_TYPE[cubeType];
    if (!grammar) {
        return null;
    }
    const moves = notation.split(' ').filter((move) => move.length > 0);
    return moves.find((move) => !hasValidMoveShape(move, grammar)) ?? null;
}
