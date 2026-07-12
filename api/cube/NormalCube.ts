// Ported from the Swift `NormalCube` in the iOS app. Faithful translation of
// the move logic; UIKit-specific rendering (getColor/CubeColorScheme) was
// dropped since it has no equivalent here, and applyScramble(Scramble) was
// collapsed into applyMoves(notation: string) since we don't have that
// wrapper type on this side.
//
// Lowercase wide-move notation (r u f l d b) and orientation rotations
// (x y z) are supported. x/y/z always rotate the whole cube regardless of
// any layer-count modifier a turn string might carry, since a rotation
// isn't depth-scoped the way a face turn is.

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

    // Solved means every face shows at most one color - not that each
    // sticker is back on its original face. This makes the check orientation
    // -independent (a pure rotation of a solved cube is still solved), and
    // tolerant of 'none' cells representing pieces a particular case doesn't
    // care about (e.g. a case that only scrambles part of the cube).
    isSolved(): boolean {
        const colorByFace = new Map<Side, Side>();
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
            }
        }
        return true;
    }

    // Blanks every cell the mask marks "don't care" (the char '.') to
    // 'none', mutating this cube in place - so isSolved() (which already
    // treats 'none' as a wildcard) skips them. Called on a fresh cube
    // before scrambling it with a case's notation, so the wildcards ride
    // along with whatever the scramble does to those cells, landing
    // wherever they need to for a correct solve. mask must have the same
    // dimensions as this cube's grid (one line per row, one char per cell).
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
        switch (letter) {
            case 'R':
                return this.R.bind(this);
            case 'L':
                return this.L.bind(this);
            case 'F':
                return this.F.bind(this);
            case 'B':
                return this.B.bind(this);
            case 'U':
                return this.U.bind(this);
            case 'D':
                return this.D.bind(this);
            case 'x':
                return this.x.bind(this);
            case 'y':
                return this.y.bind(this);
            case 'z':
                return this.z.bind(this);
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
        const { size, grid } = this;
        for (let layer = 0; layer < numLayersToTurn; layer++) {
            for (let i = 0; i < size; i++) {
                const temp = grid[size * 2 - 1 - layer][i];
                grid[size * 2 - 1 - layer][i] = grid[size * 2 - 1 - layer][size + i];
                grid[size * 2 - 1 - layer][size + i] = grid[size * 2 - 1 - layer][size * 2 + i];
                grid[size * 2 - 1 - layer][size * 2 + i] = grid[size * 3 + layer][size * 2 - 1 - i];
                grid[size * 3 + layer][size * 2 - 1 - i] = temp;
            }
        }

        this.rotateSide(size * 2, size, size);
    }

    private L(numLayersToTurn: number): void {
        const { size, grid } = this;
        for (let layer = 0; layer < numLayersToTurn; layer++) {
            for (let i = 0; i < size; i++) {
                const temp = grid[size + layer][i];
                grid[size + layer][i] = grid[size * 4 - 1 - layer][size * 2 - 1 - i];
                grid[size * 4 - 1 - layer][size * 2 - 1 - i] = grid[size + layer][size * 2 + i];
                grid[size + layer][size * 2 + i] = grid[size + layer][size + i];
                grid[size + layer][size + i] = temp;
            }
        }

        this.rotateSide(0, size, size);
    }

    private F(numLayersToTurn: number): void {
        const { size, grid } = this;
        for (let layer = 0; layer < numLayersToTurn; layer++) {
            for (let i = 0; i < size; i++) {
                const temp = grid[size + i][size - 1 - layer];
                grid[size + i][size - 1 - layer] = grid[size - 1 - layer][size * 2 - 1 - i];
                grid[size - 1 - layer][size * 2 - 1 - i] = grid[size * 2 - 1 - i][size * 2 + layer];
                grid[size * 2 - 1 - i][size * 2 + layer] = grid[size * 2 + layer][size + i];
                grid[size * 2 + layer][size + i] = temp;
            }
        }

        this.rotateSide(size, size, size);
    }

    private B(numLayersToTurn: number): void {
        const { size, grid } = this;
        for (let layer = 0; layer < numLayersToTurn; layer++) {
            for (let i = 0; i < size; i++) {
                const temp = grid[size + i][layer];
                grid[size + i][layer] = grid[size * 3 - 1 - layer][size + i];
                grid[size * 3 - 1 - layer][size + i] = grid[size * 2 - 1 - i][size * 3 - 1 - layer];
                grid[size * 2 - 1 - i][size * 3 - 1 - layer] = grid[layer][size * 2 - 1 - i];
                grid[layer][size * 2 - 1 - i] = temp;
            }
        }

        this.rotateSide(size * 3, size, size);
    }

    private U(numLayersToTurn: number): void {
        const { size, grid } = this;
        for (let layer = 0; layer < numLayersToTurn; layer++) {
            for (let i = 0; i < size; i++) {
                const temp = grid[size + i][size + layer];
                grid[size + i][size + layer] = grid[size * 2 + i][size + layer];
                grid[size * 2 + i][size + layer] = grid[size * 3 + i][size + layer];
                grid[size * 3 + i][size + layer] = grid[i][size + layer];
                grid[i][size + layer] = temp;
            }
        }

        this.rotateSide(size, 0, size);
    }

    private D(numLayersToTurn: number): void {
        const { size, grid } = this;
        for (let layer = 0; layer < numLayersToTurn; layer++) {
            for (let i = 0; i < size; i++) {
                const temp = grid[size + i][size * 2 - 1 - layer];
                grid[size + i][size * 2 - 1 - layer] = grid[i][size * 2 - 1 - layer];
                grid[i][size * 2 - 1 - layer] = grid[size * 3 + i][size * 2 - 1 - layer];
                grid[size * 3 + i][size * 2 - 1 - layer] = grid[size * 2 + i][size * 2 - 1 - layer];
                grid[size * 2 + i][size * 2 - 1 - layer] = temp;
            }
        }

        this.rotateSide(size, size * 2, size);
    }

    // Whole-cube rotation around the R/L axis, in R's direction. Turning R
    // itself across every layer already produces the correct ring-cycle for
    // the whole cube (that's exactly what "R with all layers" means), but it
    // never touches the L face's own facelets, so those need a separate
    // spin - in the reverse direction, since L and R spin with opposite
    // handedness when sharing a rotation axis (each viewed face-on).
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
