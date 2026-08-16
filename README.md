# 2048 Shooter

A portrait, one-thumb merge game: shoot a numbered tile up a column, it parks under the stack,
and every tile it touches with the same number folds into it and doubles. Keep the stacks off
the launcher.

Phaser 3 + TypeScript + Vite. No art assets — every tile is a canvas texture baked at boot, and
every sound is an oscillator.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173, and on your phone via the LAN address it prints
npm run build      # tsc --noEmit && vite build  ->  dist/
npm run preview    # serve dist/
```

`npm run shot` drives the game in a headless Chrome and drops screenshots in `scripts/.shots/`
— it needs `npm run dev` up in another terminal.

`?reset=1` wipes the save from a phone, where there is no console.

## Rules

- The well is **5 columns x 8 rows**. Every column is packed against the **top**.
- Press anywhere in the well or on the launcher strip and drag to pick a column; a dashed box
  shows exactly where the tile will land. Release to shoot.
- The tile stops under the column's stack. Then it merges with any **orthogonally adjacent**
  tile of the same value, one at a time, doubling as it goes — a 16 landing between an 8 and a
  16 goes 16 -> 32 -> 64.
- A merge punches a hole; everything under it slides **up**. If that pushes two equals together
  they merge as well, so the board is always left fully settled.
- Score is the **exponent** of each tile produced (an 8 pays 3, a 256 pays 8), times a combo
  multiplier from `COMBO_MIN` merges up.
- Every `pushEvery()` shots a **pressure row** drops in along the top and shoves every stack one
  cell closer to the launcher. The bar in the well's top edge counts down to it.
- Fill a column to the bottom row and the run ends. Revive shaves three rows off every stack.

## Stages

Stage 1 is cleared by building a **1024**, stage 2 by a **2048**, stage 3 by a **4096** — one
more doubling each time, forever. The corner badge shows the current target.

Clearing a stage pays `STAGE_COINS` and leaves the board completely untouched. Banking the
target tile and handing back the cell was tried on paper and rejected: it deletes the thing the
player spent the stage building, so the reward reads as a punishment.

What a stage *does* change is `stageDifficulty()`, fed to the dealer and to the pressure timer.
Nothing else ramps — not the board, not the spawn table, not the rules. A game that quietly
re-teaches itself at stage 3 is a game that gets put down at stage 3.

## Where the next number comes from

`src/game/spawn.ts`, and it is not a weighted die. Every deal simulates a shot of all four
candidate values into all five columns and takes the longest chain each one could produce —
its **potential**. Twenty pure `settle()` calls on a forty-cell board, so the answer is exact
rather than a heuristic that drifts out of sync with the merge rules.

The potential then picks a *band*, and the base weights still roll inside it:

| situation | band |
|---|---|
| 2 dead shots in a row | forced to potential >= 1 — the anti-frustration floor |
| board >= 50% full, or 7 shots since a payoff | potential >= 2 at 80% odds — the rescue |
| board <= 22% full | potential 0 at 65% odds — deliberate junk, so pressure builds |
| otherwise | potential >= 1 at 50% odds |

Plus two hard rules: never the same value three times running, and whatever came last is damped
to 40% weight. The rescue is 80%, not certain, on purpose — a board that always gets bailed out
has no loss condition left.

Swap (the 225-coin booster) skips the roll entirely and hands over the highest-potential value
that isn't the one you already have.

## The idle hint

Three seconds without a move (`HINT_DELAY_MS`) and the game marks the column `bestColumn` picks
for the tile in the launcher: the lane washes gold, the landing cell gets a dashed box with a
faded copy of the tile in it, and an arrow bobs at the foot of the lane. Any touch anywhere
clears it and restarts the timer.

The timer only runs while a shot is actually available — not while a chain resolves, not while
aiming, not behind the pause sheet — so a long combo finishing never pops the hint open. And it
only suggests: the marked column can be ignored.

## Feedback

Per merge: a coloured ring, sparks that grow with the chain index, a `+n` off the cell.
Per shot: dust where the tile lands. Per chain: a praise word from the ladder in `config.ts`
(2 merges "Nice!" up to 8 "UNSTOPPABLE"), `COMBO xN` underneath from 3, coins arcing into the
wallet, and the score counter rolling rather than snapping. Three shots in a row that each
merge something raise a streak banner.

The two screen-wide effects — camera shake and the white pulse — are held back to chains of
**five or more**, and a new personal-best tile only shakes from 128 up. They are the loudest
thing the game has and they only read as special while they stay rare; the lower rungs get the
word, the ring and the sparks, which is already plenty of "well done". Both thresholds are the
`shake` column of `PRAISE` plus `SHAKE_BEST_TILE`, in `config.ts`.

## Boosters

| | cost | what it does |
|---|---|---|
| Hammer | 200 | smash one tile; the column closes up and re-settles |
| Swap | 225 | reroll the launcher tile — never to the value it already was |
| Undo | 20 | take the last shot back (one step of history, on purpose) |

Coins come from combos and from reaching a tile value you have never reached before.

## Layout

```
src/game/config.ts     every tunable + the layout, in 540x1160 design units. No Phaser imports.
src/game/logic.ts      the rules as pure data: landing, merging, gravity, settling. No Phaser.
src/game/textures.ts   the tile ladder, baked to canvas textures at device resolution.
src/game/ui.ts         panels, buttons, dashed rects, the coin glyph.
src/game/audio.ts      synthesised sfx.
src/game/save.ts       localStorage, namespaced `s2048_`.
src/scenes/HomeScene   title, best, wallet, PLAY. Also where the textures get baked.
src/scenes/GameScene   the board, the HUD, the input, the animation of a merge chain.
scripts/shot.mjs       headless screenshots over raw CDP.
```

See `CLAUDE.md` for where the rules came from and what is still guesswork.
