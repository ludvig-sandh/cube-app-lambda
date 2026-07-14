// Ported from the Swift `NormalCube` in the iOS app.
// Supports Singmaster notation, explicit wide turns (Rw etc), slice moves
// (M E S), and rotations (x y z). Lowercase face letters (r u f l d b) mean
// a wide turn (face + adjacent inner layer) on every cube size except 4x4,
// where they instead mean a slice-only turn of just the layer adjacent to
// that face, with no face rotation - see getTurnFn().

type Side = 'top' | 'left' | 'front' | 'right' | 'back' | 'bottom' | 'none';

export class NormalCube {
    readonly size: number;

    private grid: Side[][];
    private readonly gridWidth: number;
    private readonly gridHeight: number;

    // size: the cube size (3 for 3x3 etc)
    constructor(size: number) {
        this.size = size;
        this.gridWidth = size * 4;
        this.gridHeight = size * 3;

        // Grid is indexed grid[x][y] and laid out as a cross/net:
        //        [top]
        // [left][front][right][back]
        //        [bottom]
        this.grid = [];
        for (let x = 0; x < this.gridWidth; x++) {
            const column: Side[] = [];
            for (let y = 0; y < this.gridHeight; y++) {
                column.push(this.getSide(x, y));
            }
            this.grid.push(column);
        }
    }

    clone(): NormalCube {
        const copy = new NormalCube(this.size);
        copy.grid = this.grid.map((column) => [...column]);
        return copy;
    }

    // Exact, position-by-position comparison - stricter than isSolved(),
    // which only cares that each face is internally uniform.
    equals(other: NormalCube): boolean {
        if (this.size !== other.size) {
            return false;
        }
        for (let x = 0; x < this.gridWidth; x++) {
            for (let y = 0; y < this.gridHeight; y++) {
                if (this.grid[x][y] !== other.grid[x][y]) {
                    return false;
                }
            }
        }
        return true;
    }

    // Allows 0-3 trailing U turns (AUF) before declaring defeat, since a
    // correct PLL algorithm may finish with the last layer permuted right
    // but rotated relative to the sides.
    isSolved(): boolean {
        const trial = this.clone();
        for (let auf = 0; auf < 4; auf++) {
            if (trial.isSolvedExact()) {
                return true;
            }
            trial.applyTurn('U');
        }
        return false;
    }

    // Solved means each face has at most one color and each color sits on
    // at most one face (both directions needed - either alone allows a
    // color to leak across faces). Ignores 'none' cells (cases that don't
    // scramble the whole cube) and doesn't care which face ends up where
    // (a pure rotation of a solved cube still counts as solved).
    private isSolvedExact(): boolean {
        const colorByFace = new Map<Side, Side>();
        const faceByColor = new Map<Side, Side>();
        for (let x = 0; x < this.gridWidth; x++) {
            for (let y = 0; y < this.gridHeight; y++) {
                const face = this.getSide(x, y);
                const color = this.grid[x][y];
                if (face === 'none' || color === 'none') {
                    continue;
                }
                const seenColor = colorByFace.get(face);
                if (seenColor === undefined) {
                    colorByFace.set(face, color);
                } else if (seenColor !== color) {
                    return false;
                }

                const seenFace = faceByColor.get(color);
                if (seenFace === undefined) {
                    faceByColor.set(color, face);
                } else if (seenFace !== face) {
                    return false;
                }
            }
        }
        return true;
    }

    // Blanks every '.' cell in the mask to 'none' so isSolved() skips it.
    // mask must have the same dimensions as this cube's grid.
    applyIgnoreMask(mask: string): void {
        const rows = mask.split('\n');
        for (let y = 0; y < this.gridHeight; y++) {
            const row = rows[y];
            for (let x = 0; x < this.gridWidth; x++) {
                if (row[x] === '.') {
                    this.grid[x][y] = 'none';
                }
            }
        }
    }

    applyMoves(notation: string): void {
        const turns = notation.split(' ').filter((part) => part.length > 0);
        for (const turn of turns) {
            this.applyTurn(turn);
        }
    }

    applyTurn(turn: string): void {
        // Find the turn and how many layers to use
        let turnLetter = turn[0];
        let numLayersToTurn = 1;
        if (turn.includes('3')) {
            numLayersToTurn = 3;
            turnLetter = turn[1];
        } else if (turn.includes('w')) {
            numLayersToTurn = 2;
        }

        // Check if it is a wide turn on 3x3
        if (turnLetter == turnLetter.toLowerCase()) {
            numLayersToTurn = 2;
        }

        // Find how many turns to do
        let numTurns = 1;
        if (turn.includes('2')) {
            numTurns = 2;
        } else if (turn.includes("'")) {
            numTurns = 3;
        }

        const turnFn = this.getTurnFn(turnLetter);
        for (let t = 0; t < numTurns; t++) {
            turnFn(numLayersToTurn);
        }
    }

    // Returns the corresponding method to call to rotate the side for the given letter
    private getTurnFn(letter: string): (numLayersToTurn: number) => void {
        // On a 4x4, lowercase face letters are slice-only turns (just the
        // layer adjacent to that face, no face rotation) rather than the
        // wide-turn meaning every other cube size uses - see the file
        // header comment.
        if (this.size === 4) {
            switch (letter) {
                case 'r':
                    return () => this.RSlice(1);
                case 'l':
                    return () => this.LSlice(1);
                case 'f':
                    return () => this.FSlice(1);
                case 'b':
                    return () => this.BSlice(1);
                case 'u':
                    return () => this.USlice(1);
                case 'd':
                    return () => this.DSlice(1);
                default:
                    break;
            }
        }

        switch (letter) {
            case 'R':
            case 'r':
                return this.R.bind(this);
            case 'L':
            case 'l':
                return this.L.bind(this);
            case 'F':
            case 'f':
                return this.F.bind(this);
            case 'B':
            case 'b':
                return this.B.bind(this);
            case 'U':
            case 'u':
                return this.U.bind(this);
            case 'D':
            case 'd':
                return this.D.bind(this);
            case 'x':
                return this.x.bind(this);
            case 'y':
                return this.y.bind(this);
            case 'z':
                return this.z.bind(this);
            case 'M':
                return this.M.bind(this);
            case 'E':
                return this.E.bind(this);
            case 'S':
                return this.S.bind(this);
            default:
                // Unrecognized letter: no-op, matching the Swift original's fallback.
                // eslint-disable-next-line @typescript-eslint/no-empty-function
                return () => {};
        }
    }

    // Returns the initial (solved) side for a grid coordinate
    private getSide(x: number, y: number): Side {
        const { size } = this;
        if (x < size) {
            if (y < size) return 'none';
            if (y < size * 2) return 'left';
            return 'none';
        } else if (x < size * 2) {
            if (y < size) return 'top';
            if (y < size * 2) return 'front';
            return 'bottom';
        } else if (x < size * 3) {
            if (y < size) return 'none';
            if (y < size * 2) return 'right';
            return 'none';
        } else {
            if (y < size) return 'none';
            if (y < size * 2) return 'back';
            return 'none';
        }
    }

    private R(numLayersToTurn: number): void {
        for (let layer = 0; layer < numLayersToTurn; layer++) {
            this.RSlice(layer);
        }

        this.rotateSide(this.size * 2, this.size, this.size);
    }

    // One depth of R()'s cycle, without R's own face rotation - reused by
    // the 4x4-only inner-slice lowercase moves (see getTurnFn()).
    private RSlice(layer: number): void {
        const { size, grid } = this;
        for (let i = 0; i < size; i++) {
            const temp = grid[size * 2 - 1 - layer][i];
            grid[size * 2 - 1 - layer][i] = grid[size * 2 - 1 - layer][size + i];
            grid[size * 2 - 1 - layer][size + i] = grid[size * 2 - 1 - layer][size * 2 + i];
            grid[size * 2 - 1 - layer][size * 2 + i] = grid[size * 3 + layer][size * 2 - 1 - i];
            grid[size * 3 + layer][size * 2 - 1 - i] = temp;
        }
    }

    private L(numLayersToTurn: number): void {
        for (let layer = 0; layer < numLayersToTurn; layer++) {
            this.LSlice(layer);
        }

        this.rotateSide(0, this.size, this.size);
    }

    // One depth of L()'s cycle, without L's own face rotation - reused by M().
    private LSlice(layer: number): void {
        const { size, grid } = this;
        for (let i = 0; i < size; i++) {
            const temp = grid[size + layer][i];
            grid[size + layer][i] = grid[size * 4 - 1 - layer][size * 2 - 1 - i];
            grid[size * 4 - 1 - layer][size * 2 - 1 - i] = grid[size + layer][size * 2 + i];
            grid[size + layer][size * 2 + i] = grid[size + layer][size + i];
            grid[size + layer][size + i] = temp;
        }
    }

    private F(numLayersToTurn: number): void {
        for (let layer = 0; layer < numLayersToTurn; layer++) {
            this.FSlice(layer);
        }

        this.rotateSide(this.size, this.size, this.size);
    }

    // One depth of F()'s cycle, without F's own face rotation - reused by S().
    private FSlice(layer: number): void {
        const { size, grid } = this;
        for (let i = 0; i < size; i++) {
            const temp = grid[size + i][size - 1 - layer];
            grid[size + i][size - 1 - layer] = grid[size - 1 - layer][size * 2 - 1 - i];
            grid[size - 1 - layer][size * 2 - 1 - i] = grid[size * 2 - 1 - i][size * 2 + layer];
            grid[size * 2 - 1 - i][size * 2 + layer] = grid[size * 2 + layer][size + i];
            grid[size * 2 + layer][size + i] = temp;
        }
    }

    private B(numLayersToTurn: number): void {
        for (let layer = 0; layer < numLayersToTurn; layer++) {
            this.BSlice(layer);
        }

        this.rotateSide(this.size * 3, this.size, this.size);
    }

    // One depth of B()'s cycle, without B's own face rotation - reused by
    // the 4x4-only inner-slice lowercase moves (see getTurnFn()).
    private BSlice(layer: number): void {
        const { size, grid } = this;
        for (let i = 0; i < size; i++) {
            const temp = grid[size + i][layer];
            grid[size + i][layer] = grid[size * 3 - 1 - layer][size + i];
            grid[size * 3 - 1 - layer][size + i] = grid[size * 2 - 1 - i][size * 3 - 1 - layer];
            grid[size * 2 - 1 - i][size * 3 - 1 - layer] = grid[layer][size * 2 - 1 - i];
            grid[layer][size * 2 - 1 - i] = temp;
        }
    }

    private U(numLayersToTurn: number): void {
        for (let layer = 0; layer < numLayersToTurn; layer++) {
            this.USlice(layer);
        }

        this.rotateSide(this.size, 0, this.size);
    }

    // One depth of U()'s cycle, without U's own face rotation - reused by
    // the 4x4-only inner-slice lowercase moves (see getTurnFn()).
    private USlice(layer: number): void {
        const { size, grid } = this;
        for (let i = 0; i < size; i++) {
            const temp = grid[size + i][size + layer];
            grid[size + i][size + layer] = grid[size * 2 + i][size + layer];
            grid[size * 2 + i][size + layer] = grid[size * 3 + i][size + layer];
            grid[size * 3 + i][size + layer] = grid[i][size + layer];
            grid[i][size + layer] = temp;
        }
    }

    private D(numLayersToTurn: number): void {
        for (let layer = 0; layer < numLayersToTurn; layer++) {
            this.DSlice(layer);
        }

        this.rotateSide(this.size, this.size * 2, this.size);
    }

    // One depth of D()'s cycle, without D's own face rotation - reused by E().
    private DSlice(layer: number): void {
        const { size, grid } = this;
        for (let i = 0; i < size; i++) {
            const temp = grid[size + i][size * 2 - 1 - layer];
            grid[size + i][size * 2 - 1 - layer] = grid[i][size * 2 - 1 - layer];
            grid[i][size * 2 - 1 - layer] = grid[size * 3 + i][size * 2 - 1 - layer];
            grid[size * 3 + i][size * 2 - 1 - layer] = grid[size * 2 + i][size * 2 - 1 - layer];
            grid[size * 2 + i][size * 2 - 1 - layer] = temp;
        }
    }

    // Whole-cube rotation around the R/L axis, in R's direction: R(size)
    // handles every layer's cycle, plus L's own face needs a reverse spin
    // (L and R turn with opposite handedness on a shared axis).
    private x(): void {
        const { size } = this;
        this.R(size);
        for (let t = 0; t < 3; t++) {
            this.rotateSide(0, size, size);
        }
    }

    // Whole-cube rotation around the U/D axis, in U's direction. See x().
    private y(): void {
        const { size } = this;
        this.U(size);
        for (let t = 0; t < 3; t++) {
            this.rotateSide(size, size * 2, size);
        }
    }

    // Whole-cube rotation around the F/B axis, in F's direction. See x().
    private z(): void {
        const { size } = this;
        this.F(size);
        for (let t = 0; t < 3; t++) {
            this.rotateSide(size * 3, size, size);
        }
    }

    // Middle slice (between L and R), in L's direction - matches standard
    // notation, where M is defined by the identity x = R M' L'.
    private M(): void {
        this.LSlice(Math.floor(this.size / 2));
    }

    // Equator slice (between U and D), in D's direction - see y = U E' D'.
    private E(): void {
        this.DSlice(Math.floor(this.size / 2));
    }

    // Standing slice (between F and B), in F's direction - see z = F S B'.
    private S(): void {
        this.FSlice(Math.floor(this.size / 2));
    }

    // Rotates a size x size subgrid given its top-left corner (startX, startY)
    private rotateSide(startX: number, startY: number, size: number): void {
        const { grid } = this;
        const lastLayer = Math.floor(size / 2) - 1;
        for (let layer = 0; layer <= lastLayer; layer++) {
            const sx = startX + layer;
            const sy = startY + layer;
            const newSize = size - 2 * layer;
            for (let i = 0; i <= newSize - 2; i++) {
                const temp = grid[sx + i][sy];
                grid[sx + i][sy] = grid[sx][sy + newSize - 1 - i];
                grid[sx][sy + newSize - 1 - i] = grid[sx + newSize - 1 - i][sy + newSize - 1];
                grid[sx + newSize - 1 - i][sy + newSize - 1] = grid[sx + newSize - 1][sy + i];
                grid[sx + newSize - 1][sy + i] = temp;
            }
        }
    }
}
