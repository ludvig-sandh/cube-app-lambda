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
