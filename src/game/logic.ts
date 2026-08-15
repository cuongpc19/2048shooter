// The rules, with no Phaser in sight. Everything here is pure data: `GameScene` asks for a
// resolution, gets back an ordered script of what happened, and animates it. Keeping the two
// apart is what makes the merge chain debuggable — a chain is a list you can print, not a pile
// of half-finished tweens.

import { COLS, ROWS, NEIGHBOURS, SPAWN_VALUES, SPAWN_WEIGHTS, mergePoints } from "./config";

/**
 * A tile carries an identity as well as a value.
 *
 * ⚠ The id is not decoration. A merge deletes a tile from the middle of a column and everything
 * under it slides up, so between two frames the same sprite can be at a different row *and* a
 * different value. Addressing tiles by (row, col) alone means the renderer has to guess which
 * sprite is which, and it guesses wrong exactly when the board is busiest.
 */
export interface Tile {
  id: number;
  value: number;
}

/** `board[row][col]`. Row 0 is the top; every column is packed against it. */
export type Board = (Tile | null)[][];

export interface Pos {
  row: number;
  col: number;
}

/** One tile absorbing one neighbour. The renderer plays these in order. */
export interface MergeStep {
  /** The tile that got eaten, and where it was standing. */
  eaten: { id: number; row: number; col: number };
  /** The tile that ate it, where it was standing, and what it became. */
  into: { id: number; row: number; col: number; value: number };
  /** Tiles that slid up to close the gap, at their new positions. */
  falls: { id: number; row: number; col: number }[];
  /** Where `into` itself ended up after the slide — it can move too. */
  at: Pos;
}

export interface Resolution {
  steps: MergeStep[];
  /** Points earned, before any combo multiplier. */
  points: number;
  /** Highest value produced anywhere in the chain (0 if nothing merged). */
  best: number;
}

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));
}

export function cloneBoard(b: Board): Board {
  return b.map((row) => row.map((t) => (t ? { ...t } : null)));
}

/** How many tiles are stacked in a column. Columns are always packed, so this is also the
 *  index of the first free row. */
export function columnHeight(b: Board, col: number): number {
  let n = 0;
  while (n < ROWS && b[n][col]) n++;
  return n;
}

/** Row a shot into `col` would land on, or -1 when the column is full. */
export function landingRow(b: Board, col: number): number {
  const n = columnHeight(b, col);
  return n < ROWS ? n : -1;
}

export function isFull(b: Board): boolean {
  for (let c = 0; c < COLS; c++) if (landingRow(b, c) < 0) return true;
  return false;
}

export function maxTile(b: Board): number {
  let m = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) if (b[r][c] && b[r][c]!.value > m) m = b[r][c]!.value;
  return m;
}

export function countTiles(b: Board): number {
  let n = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (b[r][c]) n++;
  return n;
}

export function findTile(b: Board, id: number): Pos | null {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) if (b[r][c]?.id === id) return { row: r, col: c };
  return null;
}

/**
 * Slide every tile in `col` up against row 0, and report what moved.
 *
 * Gravity points at the *ceiling*, which is the single strangest thing about this board and the
 * thing the capture is unambiguous about: shots arrive from below and park under the stack, so
 * the stack hangs from the top. When a horizontal merge punches a tile out of the middle of a
 * column, the tiles below it rise.
 */
function compactColumn(b: Board, col: number): { id: number; row: number; col: number }[] {
  const moved: { id: number; row: number; col: number }[] = [];
  let write = 0;
  for (let r = 0; r < ROWS; r++) {
    const t = b[r][col];
    if (!t) continue;
    if (r !== write) {
      b[write][col] = t;
      b[r][col] = null;
      moved.push({ id: t.id, row: write, col });
    }
    write++;
  }
  return moved;
}

/**
 * Resolve every merge triggered by the tile now standing at `start`, mutating `b`.
 *
 * One neighbour per step, in `NEIGHBOURS` order, doubling as it goes — never "absorb all the
 * equal neighbours at once".
 *
 * ⚠ That shortcut is the bug this comment exists to prevent. Two neighbours of value v folded
 * into one step is 3v of tiles becoming either 2v (a quarter of the board's value silently
 * deleted) or 4v (value invented from nothing, and the ladder stops being powers of two the
 * moment it happens). One at a time is also what the capture shows: a 16 landing between an 8
 * and a 16 goes 16 -> 32 -> 64 in two visibly separate pops, not one.
 */
export function resolveMerges(b: Board, start: Pos): Resolution {
  const steps: MergeStep[] = [];
  let points = 0;
  let best = 0;

  const self = b[start.row][start.col];
  if (!self) return { steps, points, best };
  let cur: Pos = { ...start };

  // A chain cannot outlive the board: every step deletes a tile, so ROWS*COLS is a hard
  // ceiling and the loop cannot spin even if the board is ever handed to it corrupted.
  for (let guard = 0; guard < ROWS * COLS; guard++) {
    const me = b[cur.row][cur.col];
    if (!me) break;

    let hit: Pos | null = null;
    for (const [dr, dc] of NEIGHBOURS) {
      const r = cur.row + dr;
      const c = cur.col + dc;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      const other = b[r][c];
      if (other && other.value === me.value) {
        hit = { row: r, col: c };
        break;
      }
    }
    if (!hit) break;

    const eatenTile = b[hit.row][hit.col]!;
    const eaten = { id: eatenTile.id, row: hit.row, col: hit.col };
    const from = { ...cur };

    b[hit.row][hit.col] = null;
    me.value *= 2;
    points += mergePoints(me.value);
    if (me.value > best) best = me.value;

    // Only the two columns involved can have a hole in them. Compact the eaten tile's column
    // first — if it is also our own column, our tile may ride up with it.
    const falls: { id: number; row: number; col: number }[] = [];
    falls.push(...compactColumn(b, hit.col));
    if (cur.col !== hit.col) falls.push(...compactColumn(b, cur.col));

    const now = findTile(b, me.id);
    if (!now) break; // unreachable: `me` is still on the board, but never trust that blindly
    cur = now;

    steps.push({
      eaten,
      into: { id: me.id, row: from.row, col: from.col, value: me.value },
      // The merged tile's own move is reported through `at`, so drop it from `falls` and leave
      // that list purely for bystanders — otherwise the renderer tweens the same sprite twice.
      falls: falls.filter((f) => f.id !== me.id),
      at: { ...cur },
    });
  }

  return { steps, points, best };
}

/**
 * First orthogonally-adjacent equal pair on the board, scanning top-left first, or null.
 *
 * Only right and down are checked: every pair gets found once, from its top-left member.
 */
function findPair(b: Board): Pos | null {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const t = b[r][c];
      if (!t) continue;
      if (c + 1 < COLS && b[r][c + 1]?.value === t.value) return { row: r, col: c };
      if (r + 1 < ROWS && b[r + 1][c]?.value === t.value) return { row: r, col: c };
    }
  return null;
}

/**
 * Resolve the shot, then keep going until no two touching tiles are equal.
 *
 * ⚠ The second half is not belt-and-braces, it is a rule. Chasing only the tile that moved
 * leaves pairs behind: a merge punches a hole in some column, everything under it slides up,
 * and two equal tiles end up side by side having never touched the shot. The reference capture
 * has no such pair anywhere in six minutes — the board it shows is always fully settled — and a
 * board that visibly owes the player a merge it refuses to make is the single most confusing
 * thing this genre can do.
 *
 * ⚠ It also has to feed the same `steps` list, not a second pass played after the first. The
 * combo counter is `steps.length`, and a chain that pays out in two separate bursts is two
 * small combos where the player earned one big one.
 */
export function settle(b: Board, start?: Pos): Resolution {
  const out: Resolution = start
    ? resolveMerges(b, start)
    : { steps: [], points: 0, best: 0 };
  // Bounded by the same argument as the chain loop: every step deletes a tile.
  for (let guard = 0; guard < ROWS * COLS; guard++) {
    const pair = findPair(b);
    if (!pair) break;
    const more = resolveMerges(b, pair);
    if (!more.steps.length) break; // defensive: a pair that will not merge would spin forever
    out.steps.push(...more.steps);
    out.points += more.points;
    if (more.best > out.best) out.best = more.best;
  }
  return out;
}

// ── Spawning ─────────────────────────────────────────────────────────────────

const TOTAL_WEIGHT = SPAWN_WEIGHTS.reduce((a, b) => a + b, 0);

/** A launcher tile, drawn from the weighted table in config. */
export function rollValue(rand: () => number = Math.random): number {
  let x = rand() * TOTAL_WEIGHT;
  for (let i = 0; i < SPAWN_VALUES.length; i++) {
    x -= SPAWN_WEIGHTS[i];
    if (x <= 0) return SPAWN_VALUES[i];
  }
  return SPAWN_VALUES[SPAWN_VALUES.length - 1];
}

/**
 * Any value from the table except `not` — what the swap booster hands you.
 *
 * ⚠ Excluding the current value is the entire product. A reroll that can return what you
 * already have is a booster that sometimes visibly does nothing for 225 coins, and no amount of
 * "that's just the odds" survives contact with a player who paid.
 */
export function rerollValue(not: number, rand: () => number = Math.random): number {
  const pool = SPAWN_VALUES.filter((v) => v !== not);
  if (!pool.length) return not;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

// ── Opening board ────────────────────────────────────────────────────────────

/**
 * The board you are handed at the start: a couple of small tiles in random columns.
 *
 * ⚠ Not an empty board. On an empty one the first four or five shots all fly to row 0 and stick
 * with nothing to touch, so the game opens with a stretch where no input can possibly do
 * anything interesting. Seeding it means the very first tap can already merge.
 * ⚠ And not seeded *deeply* either — one row, so the seed never sets up a chain the player did
 * not aim. Adjacent duplicates are filtered out below for the same reason.
 */
export function seedBoard(nextId: () => number, rand: () => number = Math.random): Board {
  const b = emptyBoard();
  const cols = [0, 1, 2, 3, 4].sort(() => rand() - 0.5).slice(0, 3);
  cols.sort((a, z) => a - z);
  let prev = 0;
  for (const c of cols) {
    let v = rollValue(rand);
    // Never hand out a pair that is already touching — see the note above.
    if (v === prev) v = rerollValue(v, rand);
    b[0][c] = { id: nextId(), value: v };
    prev = v;
  }
  return b;
}

// ── Serialisation (save / undo) ──────────────────────────────────────────────

/** The board as plain values, row-major, `0` for empty. */
export function toValues(b: Board): number[] {
  const out: number[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) out.push(b[r][c]?.value ?? 0);
  return out;
}

/** Rebuild a board from `toValues`, minting fresh ids. */
export function fromValues(values: number[], nextId: () => number): Board {
  const b = emptyBoard();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const v = values[r * COLS + c] ?? 0;
      if (v > 0) b[r][c] = { id: nextId(), value: v };
    }
  return b;
}
