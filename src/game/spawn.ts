// What the launcher hands you next.
//
// ⚠ This file is the difficulty curve, the pacing and most of the fun. A weighted die — which
// is what `rollValue` is, and what the first cut shipped — makes a game that is *fair* and
// completely flat: streaks of junk that no skill could have used, and jackpots that arrive when
// the board was already safe. Neither is a decision, so neither is interesting.
//
// The model here is the one Tetris and the match-3s converged on independently: **deal against
// the board, in waves.** Quiet boards get fed junk so pressure builds; loaded boards get fed a
// detonator so the pressure pays off; and a hard floor stops the game handing out a third
// consecutive tile that could not have merged anywhere no matter how well it was aimed.
//
// The whole thing rests on one cheap measurement, `potential` — and this game can afford to
// measure it exactly, by simulation, because `settle()` is pure and a board is forty cells.

import { COLS, ROWS, SPAWN_VALUES, SPAWN_WEIGHTS, PUSH_VALUES, PUSH_WEIGHTS } from "./config";
import { Board, cloneBoard, countTiles, landingRow, settle } from "./logic";

export interface Suggestion {
  /** Column to shoot into, or -1 when every column is full. */
  col: number;
  /** Merges that shot would produce. -1 alongside `col: -1`. */
  chain: number;
}

/**
 * Best column for a shot of `value`, by simulating it into every column and settling.
 *
 * Five pure `settle()` calls on a forty-cell board — cheap enough to run for all four candidate
 * values on every deal, and *exact*, so it can never drift out of sync with the merge rules the
 * way a hand-written "which tiles are exposed" heuristic would.
 *
 * ⚠ Ties break on the **shortest column**, not on the leftmost. With nothing to merge, the move
 * worth suggesting is the lane with the most room left — which is the advice a decent player
 * would give, and the one that keeps the run alive.
 */
export function bestColumn(board: Board, value: number): Suggestion {
  let best: Suggestion = { col: -1, chain: -1 };
  let bestRow = Infinity;
  for (let c = 0; c < COLS; c++) {
    const r = landingRow(board, c);
    if (r < 0) continue;
    const b = cloneBoard(board);
    // id -1 can never collide: real ids are minted from 1 upwards.
    b[r][c] = { id: -1, value };
    const chain = settle(b, { row: r, col: c }).steps.length;
    if (chain > best.chain || (chain === best.chain && r < bestRow)) {
      best = { col: c, chain };
      bestRow = r;
    }
  }
  return best;
}

/**
 * Longest merge chain a shot of `value` could produce anywhere.
 *
 * 0 = dead tile, nothing on the board can touch it.
 * 1 = one merge.
 * 2+ = a detonator.
 */
export function potential(board: Board, value: number): number {
  return Math.max(0, bestColumn(board, value).chain);
}

export interface DealerState {
  /** Value dealt last, and how many times in a row it has come up. */
  last: number;
  run: number;
  /** Consecutive *fired* shots that merged nothing. The anti-frustration counter. */
  dry: number;
  /** Shots since a chain of `BIG_CHAIN` or more. Drives the payoff pity timer. */
  since: number;
}

export function newDealer(): DealerState {
  return { last: 0, run: 0, dry: 0, since: 0 };
}

// ── Tuning ───────────────────────────────────────────────────────────────────
//
// Everything below is a pair: the value at difficulty 0 (stage 1) and the value at difficulty 1
// (stage 4 and up). `deal` interpolates between them. Difficulty never touches the board, the
// spawn table or the rules — only how willing the dealer is to help.

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Board fill above which the player is in trouble and might get a way out. */
const HOT = [0.52, 0.72] as const;
/** Board fill below which there is nothing to work with and pressure should build. */
const COLD = [0.22, 0.15] as const;
/** Chain length that counts as a payoff, for the pity timer. */
const BIG_CHAIN = 3;
/** Shots without a payoff before the dealer starts actively looking for one. */
const PITY = [8, 14] as const;
/** Same value more than this many times running is a coincidence nobody believes. */
const MAX_RUN = 2;

/**
 * Dead shots in a row before the next tile is *forced* to be usable.
 *
 * ⚠ Fixed at 2. It does **not** scale with difficulty and it never should: this is the
 * anti-frustration floor, and "the game gets more annoying as you get better" is not a
 * difficulty curve. Everything else here is allowed to get meaner; this one stays.
 */
const DRY_LIMIT = 2;

/**
 * Odds of *deliberately* handing over a detonator when the board is hot.
 *
 * ⚠ Never 1.0. A dealer that always rescues a full board removes the loss condition, and a game
 * you cannot lose stops being one after about four minutes.
 */
const RESCUE_ODDS = [0.7, 0.28] as const;
/** Odds of deliberately handing over junk when the board is nearly empty. */
const BUILD_ODDS = [0.7, 0.9] as const;

/**
 * Odds of forcing junk in the *middle* band — the ordinary case, neither hot nor cold.
 *
 * ⚠ This is the single biggest difficulty lever in the game, and the reason the first cut was
 * unloseable. The band machinery below only ever chose between "prefer useful" and "no
 * preference" — but on a board with a few different values exposed, *most* candidates are
 * useful anyway, so "no preference" still dealt a usable tile around nine times in ten. A greedy
 * bot merged on 93% of its shots and the board never grew: 150 shots in, it was 14 tiles full.
 * Making the game harder needs the dealer to actively withhold, not merely to stop helping.
 */
const JUNK_ODDS = [0.3, 0.62] as const;

/** Odds of preferring a usable tile in the middle band, when junk was not forced. */
const LIVE_ODDS = [0.45, 0.15] as const;

// ── The deal ─────────────────────────────────────────────────────────────────

interface Candidate {
  value: number;
  weight: number;
  pot: number;
}

function pickWeighted(pool: Candidate[], rand: () => number): number {
  const total = pool.reduce((a, c) => a + c.weight, 0);
  if (total <= 0) return pool[Math.floor(rand() * pool.length) % pool.length].value;
  let x = rand() * total;
  for (const c of pool) {
    x -= c.weight;
    if (x <= 0) return c.value;
  }
  return pool[pool.length - 1].value;
}

/**
 * Choose the next launcher value.
 *
 * The shape is: score every candidate by what it could actually do to *this* board, decide
 * which band of outcomes the moment calls for, then roll the base distribution inside that
 * band. The base weights still do the work of making a 16 feel rare — the board-awareness only
 * chooses *which* rare tile, never how often a rare tile comes up.
 *
 * ⚠ The board passed in is one shot stale by the time this value is fired, because there is a
 * next-tile preview and the preview has to be decided before the shot in front of it happens.
 * That is inherent to showing a preview at all, and it is why `dry` is updated from the *real*
 * outcome in `noteShot` rather than from `potential` — the guarantee has to be measured on what
 * happened, not on what was predicted.
 */
export function deal(
  board: Board,
  st: DealerState,
  difficulty = 0,
  rand: () => number = Math.random,
): number {
  const d = Math.max(0, Math.min(1, difficulty));
  const fill = countTiles(board) / (ROWS * COLS);

  let pool: Candidate[] = SPAWN_VALUES.map((value, i) => ({
    value,
    weight: SPAWN_WEIGHTS[i],
    pot: potential(board, value),
  }));

  // Hard rule first: no long runs of the same number. Three 2s in a row reads as a broken
  // random number generator even when it is not, and players do not forgive it.
  if (st.run >= MAX_RUN) {
    const trimmed = pool.filter((c) => c.value !== st.last);
    if (trimmed.length) pool = trimmed;
  }

  const live = pool.filter((c) => c.pot >= 1);
  const big = pool.filter((c) => c.pot >= 2);
  const dead = pool.filter((c) => c.pot === 0);

  let band = pool;

  if (st.dry >= DRY_LIMIT && live.length) {
    // The floor. Two dead shots in a row is bad luck; three is the game wasting the player's
    // time, and no amount of "that's just probability" is heard as anything else.
    band = live;
  } else if (
    (fill >= lerp(HOT[0], HOT[1], d) || st.since >= lerp(PITY[0], PITY[1], d)) &&
    big.length &&
    rand() < lerp(RESCUE_ODDS[0], RESCUE_ODDS[1], d)
  ) {
    // The payoff: the board is loaded, or nothing has gone off in a while. Detonate.
    band = big;
  } else if (fill <= lerp(COLD[0], COLD[1], d) && dead.length && rand() < lerp(BUILD_ODDS[0], BUILD_ODDS[1], d)) {
    // The build-up: an empty board has nothing to lose, so spend these shots stacking
    // something worth blowing up later.
    band = dead;
  } else if (dead.length && rand() < lerp(JUNK_ODDS[0], JUNK_ODDS[1], d)) {
    // Withholding. The dry floor above is what keeps this from being cruel: it can cost the
    // player two shots in a row and never a third.
    band = dead;
  } else if (live.length && rand() < lerp(LIVE_ODDS[0], LIVE_ODDS[1], d)) {
    band = live;
  }

  // Inside the chosen band, damp whatever came last so the launcher does not stutter.
  const scored = band.map((c) => ({ ...c, weight: c.weight * (c.value === st.last ? 0.4 : 1) }));
  const value = pickWeighted(scored, rand);

  st.run = value === st.last ? st.run + 1 : 1;
  st.last = value;
  return value;
}

/** Fold the outcome of a fired shot back into the dealer. Call once per shot. */
export function noteShot(st: DealerState, merges: number): void {
  st.dry = merges > 0 ? 0 : st.dry + 1;
  st.since = merges >= BIG_CHAIN ? 0 : st.since + 1;
}

/**
 * One pressure row: `COLS` small values, never two equal side by side.
 *
 * ⚠ The no-neighbours rule is the whole point. A row that lands with a matching pair already in
 * it detonates on arrival and gives the player back the space it was meant to take away.
 */
export function pressureRow(rand: () => number = Math.random): number[] {
  const total = PUSH_WEIGHTS.reduce((a, b) => a + b, 0);
  const roll = () => {
    let x = rand() * total;
    for (let i = 0; i < PUSH_VALUES.length; i++) {
      x -= PUSH_WEIGHTS[i];
      if (x <= 0) return PUSH_VALUES[i];
    }
    return PUSH_VALUES[PUSH_VALUES.length - 1];
  };
  const row: number[] = [];
  for (let c = 0; c < COLS; c++) {
    let v = roll();
    // Three values in the pool, so at most two retries can ever be needed.
    for (let i = 0; i < 4 && v === row[c - 1]; i++) v = roll();
    row.push(v);
  }
  return row;
}

/**
 * What the swap booster hands over: the most useful value that is not the one you have.
 *
 * ⚠ Deterministically the best, not another roll. This costs 225 coins — the most expensive
 * thing in the game — and it is bought at a moment the player has already looked at the board
 * and decided the current tile is useless. A reroll that hands back another useless tile is a
 * refund request, and "those were the odds" has never once been accepted as an answer.
 */
export function bestSwap(board: Board, current: number, rand: () => number = Math.random): number {
  const pool = SPAWN_VALUES.filter((v) => v !== current).map((value) => ({
    value,
    pot: potential(board, value),
  }));
  if (!pool.length) return current;
  const top = Math.max(...pool.map((c) => c.pot));
  const best = pool.filter((c) => c.pot === top);
  return best[Math.floor(rand() * best.length) % best.length].value;
}
