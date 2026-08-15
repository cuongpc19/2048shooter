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
- Fill a column to the bottom row and the run ends. Revive shaves three rows off every stack.

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
