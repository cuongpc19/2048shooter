// Every tunable number the game is built on. Layout lives here too, in *design units*
// (a 540x1160 portrait box); the scene renders through a camera zoomed to the device pixel
// ratio, so nothing below ever has to know what a real pixel is.
//
// The one rule: `logic.ts` must stay importable from plain Node, so this file must never
// import Phaser.

export const GAME_W = 540;
export const GAME_H = 1160;

// ── Board ────────────────────────────────────────────────────────────────────
/**
 * Columns and rows of the well.
 *
 * Five columns, eight rows — read straight off the reference capture, and the two are not
 * independent. Five is what makes a horizontal merge chain reachable (a tile can touch two
 * neighbours at once without the board being so wide that any one column is ever "far away"),
 * and eight is how much rope you get before a column reaches the launcher: with a tap costing
 * roughly one row and a good merge paying back three, eight rows is about a dozen careless
 * shots. Widening to six columns makes the board forgiving enough that the loss condition
 * stops existing; shortening to six rows makes the first mis-tap fatal.
 */
export const COLS = 5;
export const ROWS = 8;

/** Highest tile the value ladder is drawn for. Past this the colour repeats. */
export const MAX_EXP = 17;

// ── Rules ────────────────────────────────────────────────────────────────────
/**
 * What the launcher may hand you. Fixed, and deliberately *not* scaled with the board.
 *
 * ⚠ Tempting to raise the floor once a 256 exists ("2s are useless now") — the capture says
 * no: the player is still being handed 2s with a 256 on the board. The small tiles are the
 * difficulty. A 2 landing in the wrong column is the mistake the whole game is made of, and a
 * launcher that quietly stops dealing them removes the only pressure there is.
 */
export const SPAWN_VALUES = [2, 4, 8, 16];
/** Weights for the above, in the same order. Small tiles are common; a 16 is a gift. */
export const SPAWN_WEIGHTS = [34, 30, 22, 14];

/**
 * Merge search order around a landed tile: up, left, right, down.
 *
 * ⚠ Up first, and this is load-bearing rather than arbitrary. A tile lands directly under the
 * column's stack, so "up" is the neighbour it was aimed at; resolving that one first is what
 * makes a shot do the thing the player just planned. Resolving sideways first would let a
 * chance horizontal pair steal the merge and leave the aimed-at tile sitting there, which
 * reads as the game ignoring the shot.
 */
export const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [0, -1],
  [0, 1],
  [1, 0],
];

/**
 * Points for one merge = the exponent of the tile it produced (8 -> 3, 256 -> 8).
 *
 * ⚠ Not the tile's face value, which is the obvious choice and is wrong here. Scoring 256 for
 * a 256 makes the last merge of a chain worth more than the hundred merges that built it, so
 * the number on the HUD stops tracking how well the board is being played and only tracks the
 * biggest tile — which is already its own badge in the corner. The reference capture ends a
 * six-minute run with a 256 on the board and a score of 527, which is the exponent sum, not
 * anything close to a face-value total.
 */
export function mergePoints(value: number): number {
  return Math.round(Math.log2(value));
}

/** Merges in one shot before it counts as a combo (and starts paying a bonus). */
export const COMBO_MIN = 3;

/**
 * The praise ladder, keyed on how many merges one shot produced.
 *
 * ⚠ It starts at **2**, not at `COMBO_MIN`. The combo bonus and the praise are two different
 * jobs: the bonus is an economy dial and should stay expensive, while the praise is the
 * game telling the player their aim worked, and that has to happen on the very first shot that
 * does anything clever or the feedback arrives too late to teach anything.
 *
 * ⚠ Each rung must be *visibly* louder than the one below — bigger, and a warmer hue. A ladder
 * whose rungs all look the same is worse than no ladder, because the player learns the words
 * are decoration and stops reading them.
 */
export interface Praise {
  /** Minimum chain length. Highest matching rung wins. */
  min: number;
  word: string;
  size: number;
  tint: number;
  /**
   * Camera shake, in the units `Camera.shake` takes. 0 for everything but the top rungs.
   *
   * ⚠ Shake is the loudest thing this game can do and it only works while it stays rare. A
   * two-merge chain happens several times a minute; shaking the screen for it makes the whole
   * board jitter through ordinary play, and by the time a genuinely huge chain lands there is
   * no headroom left to mark it with. The bottom three rungs get the word, the ring and the
   * sparks — that is already plenty of "well done" — and the camera stays still until five.
   */
  shake: number;
}

export const PRAISE: Praise[] = [
  { min: 2, word: "Nice!", size: 44, tint: 0x7ee2a8, shake: 0 },
  { min: 3, word: "Great!", size: 52, tint: 0x63e2d4, shake: 0 },
  { min: 4, word: "Awesome!", size: 58, tint: 0x8ba0ff, shake: 0 },
  { min: 5, word: "Amazing!", size: 64, tint: 0xdd8bf2, shake: 0.005 },
  { min: 6, word: "So Good!", size: 68, tint: 0xffdd7a, shake: 0.009 },
  { min: 8, word: "UNSTOPPABLE", size: 54, tint: 0xff8098, shake: 0.014 },
];

/**
 * Tile value a new personal best has to reach before it earns a shake of its own.
 *
 * ⚠ Without this the early game shakes constantly: the first 8, 16, 32 and 64 of a fresh save
 * are each a new best, they arrive within the first minute, and most come off a single merge.
 * A "new best" is only an event once it is actually hard to reach.
 */
export const SHAKE_BEST_TILE = 128;

export function praiseFor(chain: number): Praise | null {
  let hit: Praise | null = null;
  for (const p of PRAISE) if (chain >= p.min) hit = p;
  return hit;
}

/**
 * Shots in a row that each merged something, before the streak banner appears.
 *
 * A second, slower reward loop laid over the per-shot one: the praise ladder rewards a single
 * good shot, the streak rewards not wasting any. Three is where it starts being an achievement
 * rather than a coincidence.
 */
export const STREAK_MIN = 3;

/**
 * Idle time before the game points at a column for you.
 *
 * ⚠ Three seconds is short on purpose, and it is short because of *who is stalling*. A player
 * who knows what they are doing never sees this — they are already mid-tap — so the only person
 * it reaches is one who is stuck, and a hint that waits eight seconds to help someone who was
 * lost at three has spent five seconds teaching them the game has nothing to say.
 * ⚠ It suggests, it does not gate. The hint marks a column and the player is free to ignore it;
 * anything that blocks input until the suggested move is played stops being a hint.
 */
export const HINT_DELAY_MS = 3000;

// ── Economy ──────────────────────────────────────────────────────────────────
export const COINS_START = 120;
/** Coins for each merge in a chain past the first — combos are what pay for boosters. */
export const COIN_PER_COMBO_STEP = 1;
/** Coins for reaching a tile value never reached before in this run. */
export const COIN_PER_NEW_BEST_TILE = 25;

export const PRICE_HAMMER = 200;
export const PRICE_SWAP = 225;
export const PRICE_UNDO = 20;
/**
 * Revive, offered once the well fills up.
 *
 * ⚠ Priced below the hammer on purpose. A revive is bought at the one moment the player has
 * already lost, so pricing it *above* the routine boosters turns the death screen into the
 * only thing coins are for and makes the other three ornamental.
 */
export const PRICE_REVIVE = 150;
/** Rows cleared off the bottom of every stack by a revive. */
export const REVIVE_ROWS = 3;

// ── Colours ──────────────────────────────────────────────────────────────────
/**
 * The value ladder, indexed by exponent (so `TILE_COLORS[1]` is the 2).
 *
 * Cyan -> blue -> violet -> magenta -> red -> orange -> gold: one continuous sweep, so a
 * player reads "how big" off the hue before they read the digits. That matters most in the
 * middle of a chain, when three tiles are moving at once and there is no time to read numbers.
 */
export interface Swatch {
  base: number;
  light: number;
  dark: number;
}

export const TILE_COLORS: Swatch[] = [
  { base: 0x2b3550, light: 0x3d4a6b, dark: 0x1b2236 }, // exp 0 — unused, keeps indexing honest
  { base: 0x26d0e0, light: 0x6ceaf5, dark: 0x1590a3 }, // 2
  { base: 0x3b8ef5, light: 0x7fbcff, dark: 0x1f5fba }, // 4
  { base: 0x4a6cf7, light: 0x8ba0ff, dark: 0x2a41ba }, // 8
  { base: 0x7b5cf0, light: 0xae95ff, dark: 0x4e34b4 }, // 16
  { base: 0xb845dd, light: 0xdd8bf2, dark: 0x7d21a0 }, // 32
  { base: 0xf2385a, light: 0xff8098, dark: 0xb01033 }, // 64
  { base: 0xf4562a, light: 0xff9670, dark: 0xb02c07 }, // 128
  { base: 0xf97316, light: 0xffab5e, dark: 0xb44a00 }, // 256
  { base: 0xfbbf24, light: 0xffdd7a, dark: 0xb8850a }, // 512
  { base: 0xf2e04a, light: 0xfff196, dark: 0xb0a000 }, // 1024
  { base: 0xa3e635, light: 0xd0f785, dark: 0x69a010 }, // 2048
  { base: 0x22c55e, light: 0x74e79a, dark: 0x0d8a3a }, // 4096
  { base: 0x14b8a6, light: 0x63e2d4, dark: 0x00806f }, // 8192
  { base: 0x0ea5e9, light: 0x69cdf7, dark: 0x0369a1 }, // 16384
  { base: 0x8b5cf6, light: 0xc0a3ff, dark: 0x5b21b6 }, // 32768
  { base: 0xec4899, light: 0xff8fc4, dark: 0xa61e63 }, // 65536
  { base: 0xf5f5f5, light: 0xffffff, dark: 0xb8b8b8 }, // 131072
];

export function swatch(value: number): Swatch {
  const exp = Math.round(Math.log2(value));
  return TILE_COLORS[Math.max(1, Math.min(MAX_EXP, exp))];
}

export const UI = {
  bg: 0x12111c,
  bgGlow: 0x1d1a30,
  well: 0x1a1828,
  wellEdge: 0x2a2740,
  track: 0x201d31,
  panel: 0x1e1b2e,
  panelEdge: 0x33304c,
  ink: "#f2f4ff",
  inkDim: "#8b88a8",
  gold: 0xffb020,
  danger: 0xf2385a,
  ghost: 0xffffff,
};

// ── Layout, in design units ──────────────────────────────────────────────────
export const CELL = 92;
export const GAP = 8;
export const PITCH = CELL + GAP;

export const BOARD_W = COLS * PITCH - GAP; // 492
export const BOARD_H = ROWS * PITCH - GAP; // 792
export const BOARD_X = Math.round((GAME_W - BOARD_W) / 2); // 24
/**
 * Top of the well.
 *
 * ⚠ Everything above it is HUD and everything below is board — `bindInput` uses this exact
 * number to decide whether a press is an aim or a mis-grab on the chrome. Move it and the two
 * booster rows above have to be re-checked for overlap; they are already only a few pixels
 * clear of it.
 */
export const BOARD_Y = 244;
export const BOARD_BOTTOM = BOARD_Y + BOARD_H; // 1036

/** Centre x of column `c`. */
export function colX(c: number): number {
  return BOARD_X + CELL / 2 + c * PITCH;
}
/** Centre y of row `r`. */
export function rowY(r: number): number {
  return BOARD_Y + CELL / 2 + r * PITCH;
}

/**
 * The launcher row, below the well.
 *
 * ⚠ It is a *row of five slots*, one per column, not a single cannon that swings. The capture
 * shows the live tile parked in one slot and a small chevron in the other four, and the whole
 * input model follows from that: a tap on a column is a shot into that column, so the shot is
 * one gesture with no aiming phase. A swinging cannon would make every shot cost an aim and a
 * release, which is twice the input for a game whose pace is its point.
 */
export const LAUNCH_Y = BOARD_BOTTOM + 62; // 1098
export const LAUNCH_H = 84;

/**
 * HUD slots. Two rows: score furniture on top, wallet + boosters underneath.
 *
 * ⚠ `goal` and `boosters` share the right-hand edge, and the goal badge's "Locked" caption sits
 * *between* the two rows. The first cut had them 15px apart and the booster panel painted over
 * the bottom half of the word — which is invisible in a design file and obvious the moment a
 * screenshot exists. Keep the caption above y=140 and the booster row below y=155.
 */
export const HUD = {
  pause: { x: 56, y: 86, size: 60 },
  score: { x: 250, y: 86 },
  goal: { x: 470, y: 84, size: 58 },
  coin: { x: 34, y: 186 },
  /** The on-deck tile, small, between the wallet and the boosters. `label` is the caption's
   *  left edge — it is left-aligned, so it grows towards the tile and must start clear of it. */
  next: { x: 214, y: 186, label: 138 },
  boosters: { y: 186, size: 60, gap: 82, right: 486 },
};
