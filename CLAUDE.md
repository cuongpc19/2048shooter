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
