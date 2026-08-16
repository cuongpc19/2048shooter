# 2048 Shooter — working notes

## Where the rules came from

There is no design doc. The spec is a 5m46s phone capture of the reference game, at
`Manythings/IMG_6591.MP4` — gitignored, because it is a 23MB screen recording of someone else's
app and it does not belong in the repo.

Everything in `logic.ts` was read off that capture frame by frame. The decisive stretch is
**t=8s to t=37s**, where the board is nearly empty and each shot can be followed individually:

| t | board (row 0) | launcher | what it proves |
|---|---|---|---|
| 8s | `_ 8 16 _ _` | 2 | tiles pack against the **top**, not the bottom |
| 14s | `_ 32 _ 4 2` | 4 | a shot into an occupied column parks at **row 1**, under the stack |
| 17s | `_ 32 8 4 2` | 4 | 8 lands beside a 32 and a 4 — no merge, so it is value equality, not adjacency |
| 20s | `_ 32 _ 16 2` | — | the 4 ate the shot 4 -> 8, then the 8 at column 3 -> **16**. Horizontal merges are real |
| 32s | `_ 32 _ 16 4` | 16 | — |
| 34s | `_ _ 64 _ 4` | — | shot 16 -> ate the 16 -> 32 -> ate the 32 -> **64**, one cell, two pops. Chains cascade |

Two things the capture settles by never showing them:

- **No new row ever pushes in from the top.** Row 0 sits unchanged for minutes at a time. All
  the pressure in this game comes from the player's own shots.
- **No two orthogonally adjacent equal tiles ever exist**, in six minutes. That is why
  `settle()` keeps going after the shot's own chain — gravity can push two equals together and
  the board must not be left owing a merge. See the note on `settle` in `logic.ts`.

## Still guesswork — confirm before building on it

1. **Scoring.** `mergePoints` = the exponent of the tile produced. It fits (the run ends at 527
   with a 256 on the board, which is roughly the exponent sum and nowhere near a face-value
   total) but it was never stated. The combo multiplier is invented outright.
2. **Coin income.** Rate was read off a slow drift from 306 to 317 over six minutes. The split
   between combo payouts and new-best-tile payouts is a guess.
3. **Booster effects.** The three HUD buttons and their prices (200 / 225 / 20) are straight
   from the capture; *what they do* is not — the player never presses one. Hammer / swap /
   undo is inferred from the icons.
4. **Board height.** Eight rows, counted off the capture, but the reference's bottom row is
   partly under the launcher strip so it could be nine.
5. **The grey circle** at the right of the reference's booster row is unidentified. This build
   put the next-tile preview in the HUD instead.

## The dealer

`spawn.ts` is the difficulty curve and most of the pacing. It measures `potential(board, v)` —
the longest chain a shot of `v` could produce anywhere — by simulation, and uses it to choose a
band of outcomes: a floor that refuses to deal a third consecutive dead tile, a rescue on hot
boards, deliberate junk on cold ones.

`bestColumn(board, value)` is the same simulation exposed per-column, and it does double duty:
`potential()` is defined in terms of it, and the idle hint points at whatever it returns. One
simulator, so the hint can never advise a move the dealer's own model disagrees with.

All the tuning is the block of constants at the top of that file, each written as a pair
`[at difficulty 0, at difficulty 1]` and interpolated by `deal`. `DRY_LIMIT` is the exception
and stays fixed at 2 — it is the anti-frustration floor, and "the game gets more annoying as you
get better" is not a difficulty curve.

⚠ The preview tile is decided one shot early — that is inherent to having a preview at all — so
the anti-frustration counters (`dry`, `since`) are updated from the *real* outcome via
`noteShot`, never from the prediction. Do not "simplify" that by folding them into `deal`.

## Why pressure rows exist

They are **not in the reference capture** — six minutes were checked twice and row 0 never gains
a tile except by a merge. They are here because without them the game cannot be lost, and that
is arithmetic:

> a shot adds one tile, a merge removes one, so the board grows by `1 - mergeRate` per shot

Once a board has 2, 4, 8 and 16 exposed along its bottom edge, *every* value the launcher can
deal merges with something. Measured: **0.96 merges per shot**, a board that grows by one tile
every twenty-five shots, and a greedy bot still alive and comfortable at 200 shots with eleven
tiles on the board. No dealer tuning reaches that — on such a board there is no unusable tile
left to deal. The only other lever would be dealing values the board has outgrown, which the
capture rules out (it deals 2s with a 256 on the board).

If the mechanic is ever removed, the loss condition goes with it.

## Measuring difficulty

`npm run shot -- --taps 900` prints one line that is the whole measurement:

```
survived: 371/900 shots · 37/40 tiles · max 1024 · score 3096 · DIED
```

`?stage=N` (dev builds only) starts a run at that stage, so a late-stage board can be measured
without first grinding up to a 4096.

Where it stands, three samples per stage with the current bot:

| start | shots survived | best tile |
|---|---|---|
| stage 1 | 200 / 220 / 140 | 512 |
| stage 4 | 90 / 120 / 100 | 256 |

⚠ **Run length is noisy — never tune off one sample.** A single stage-1 run came back at 371
shots with a 1024 and it was an outlier; three clean samples put the median at 200. Anything
inside about ±40 shots is indistinguishable from luck, so a change has to move the median across
several runs before it has been shown to do anything.

⚠ **The bot's policy is part of the measurement, and getting it wrong invalidates the numbers.**
Three policies were tried:

| policy | typical run | best tile |
|---|---|---|
| random columns | ~20 shots | — |
| any merge, then emptiest column | 280 | 512 |
| longest cascade wins | 140 | 256 |
| merge first, then emptiest, cascade as tiebreak | 200 | 512 |

The middle two both *look* reasonable and both die of their own play rather than of the
difficulty being tuned — with the second one, changing `PUSH_EVERY` from 16 to 20 moved the run
by eight shots and nothing else, which reads as "pressure does not matter" and is entirely an
artefact. Always measure with the strongest policy available.

⚠ Do not edit `src/` while a measurement is running. Vite's HMR reloads the scene mid-run and
the harness comes back with an empty result — which looks like a crash, not like the own goal
it is.

## Shape of the code

`config.ts` and `logic.ts` must stay free of Phaser imports — the rules are meant to be
runnable from plain Node so a headless sim can be written against them later.

Everything is in **design units**: a 540x1160 portrait box. `main.ts` sizes the canvas at
`design x devicePixelRatio` and each scene zooms its camera by the same factor, so no
coordinate anywhere in the codebase is a real pixel. Two consequences that bite:

- Canvas text must be created through `ui.ts`'s `txt()`, which sets `setResolution(dpr)`.
  Without it labels are upscaled 1x renders and go soft next to the baked tile art.
- Tile textures are baked at `CELL * dpr` and every tile sprite is drawn at scale `1/dpr`
  (`GameScene.TS`). A sprite that sets its own scale must go through that constant.

## Checking a change

```bash
npm run dev          # one terminal
npm run shot         # another: greedy bot plays 10 shots, screenshots + console dump
npm run shot -- --taps 45
```

`shot.mjs` reads `GameScene.debugState()` to choose columns. It is a **greedy** bot, not a
random one: random tapping dies in twenty shots, photographs an empty board, and then keeps
tapping through the game-over sheet and silently restarts the run.

`--taps 45` on the greedy bot should land somewhere around a 64 with the board still shallow.
If it dies early, something in the merge chain has broken.
