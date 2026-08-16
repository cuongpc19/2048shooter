import Phaser from "phaser";
import {
  GAME_W,
  GAME_H,
  COLS,
  ROWS,
  CELL,
  GAP,
  PITCH,
  BOARD_X,
  BOARD_Y,
  BOARD_W,
  BOARD_H,
  BOARD_BOTTOM,
  LAUNCH_Y,
  LAUNCH_H,
  HUD,
  UI,
  COMBO_MIN,
  STREAK_MIN,
  HINT_DELAY_MS,
  SHAKE_BEST_TILE,
  praiseFor,
  mergePoints,
  COIN_PER_COMBO_STEP,
  COIN_PER_NEW_BEST_TILE,
  PRICE_HAMMER,
  PRICE_SWAP,
  PRICE_UNDO,
  PRICE_REVIVE,
  REVIVE_ROWS,
  colX,
  rowY,
  swatch,
} from "../game/config";
import {
  Board,
  Resolution,
  columnHeight,
  fromValues,
  isFull,
  landingRow,
  maxTile,
  seedBoard,
  settle,
  toValues,
} from "../game/logic";
import { DealerState, bestColumn, bestSwap, deal, newDealer, noteShot } from "../game/spawn";
import { save } from "../game/save";
import { tileKey } from "../game/textures";
import { txt, panel, button, dashedRect, coinIcon } from "../game/ui";
import { sfx, unlockAudio } from "../game/audio";

interface Snapshot {
  values: number[];
  score: number;
  coins: number;
  current: number;
  next: number;
  launchCol: number;
}

type Booster = "none" | "hammer";

export class GameScene extends Phaser.Scene {
  // ── state ──────────────────────────────────────────────────────────────────
  private board!: Board;
  private tiles = new Map<number, Phaser.GameObjects.Image>();
  private idSeq = 1;

  private current = 2;
  private next = 2;
  private launchCol = Math.floor(COLS / 2);

  private score = 0;
  /** What the HUD is *currently showing*. It chases `score` so the number rolls up. */
  private shownScore = 0;
  private coins = 0;
  private bestTile = 0;
  /** Shots in a row that merged at least once. */
  private streak = 0;
  private dealer: DealerState = newDealer();

  /** True while a shot is flying or a chain is resolving — no input gets through. */
  private busy = false;
  /** True while the pause or game-over sheet is up. */
  private modal = false;
  private over = false;
  private armed: Booster = "none";

  private undoStack: Snapshot[] = [];

  // ── display ────────────────────────────────────────────────────────────────
  /** Scale that makes a `CELL * dpr` texture draw at `CELL` design units. */
  private TS = 1;
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private coinText!: Phaser.GameObjects.Text;
  private goalLabel!: Phaser.GameObjects.Text;
  private goalTile!: Phaser.GameObjects.Image;
  private ghost!: Phaser.GameObjects.Graphics;
  private ghostTile!: Phaser.GameObjects.Image;
  private trackFx!: Phaser.GameObjects.Graphics;
  private launchTile!: Phaser.GameObjects.Image;
  private nextTile!: Phaser.GameObjects.Image;
  private boosterLabels: Phaser.GameObjects.Text[] = [];
  private aiming = false;
  private aimCol = 0;

  // ── hint ───────────────────────────────────────────────────────────────────
  /** Milliseconds the player has been able to move and hasn't. */
  private idleMs = 0;
  private hintOn = false;
  private hintG!: Phaser.GameObjects.Graphics;
  private hintTile!: Phaser.GameObjects.Image;
  private hintArrow!: Phaser.GameObjects.Graphics;
  private hintTweens: Phaser.Tweens.Tween[] = [];

  constructor() {
    super("Game");
  }

  create(): void {
    const dpr = (this.registry.get("dpr") as number) || 1;
    this.cameras.main.setZoom(dpr).centerOn(GAME_W / 2, GAME_H / 2);
    this.TS = 1 / dpr;

    this.coins = Math.max(0, save.coins);
    this.bestTile = save.bestTile;
    this.score = 0;
    this.shownScore = 0;
    this.streak = 0;
    this.dealer = newDealer();
    this.over = false;
    this.modal = false;
    this.busy = false;
    this.armed = "none";
    this.undoStack = [];
    this.tiles.clear();
    this.idSeq = 1;

    this.drawBackdrop();
    this.buildHud();
    this.buildLauncher();

    this.board = seedBoard(() => this.idSeq++);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const t = this.board[r][c];
        if (t) this.addSprite(t.id, t.value, r, c);
      }

    this.current = deal(this.board, this.dealer);
    this.next = deal(this.board, this.dealer);
    this.refreshLauncher(false);
    this.refreshHud();
    this.paintDanger();

    this.bindInput();
  }

  // ── static art ─────────────────────────────────────────────────────────────

  private drawBackdrop(): void {
    const g = this.add.graphics().setDepth(-20);
    g.fillStyle(UI.bg, 1).fillRect(0, 0, GAME_W, GAME_H);

    // The well. One rounded box behind five column tracks: the box is what the stacks live in,
    // the tracks are what a shot travels along, and keeping them visually separate is what lets
    // a player see an empty column as a *lane* rather than as background.
    const well = this.add.graphics().setDepth(-15);
    well
      .fillStyle(UI.well, 1)
      .fillRoundedRect(BOARD_X - 10, BOARD_Y - 10, BOARD_W + 20, BOARD_H + 20, 22);
    well
      .lineStyle(2, UI.wellEdge, 1)
      .strokeRoundedRect(BOARD_X - 10, BOARD_Y - 10, BOARD_W + 20, BOARD_H + 20, 22);

    for (let c = 0; c < COLS; c++) {
      well
        .fillStyle(UI.track, 1)
        .fillRoundedRect(BOARD_X + c * PITCH, BOARD_Y, CELL, BOARD_H, 14);
    }

    // Per-column danger wash, repainted whenever the board changes.
    this.trackFx = this.add.graphics().setDepth(-14);

    // The launcher strip.
    const strip = this.add.graphics().setDepth(-15);
    strip
      .fillStyle(UI.panel, 1)
      .fillRoundedRect(BOARD_X - 10, LAUNCH_Y - LAUNCH_H / 2, BOARD_W + 20, LAUNCH_H, 18);
    for (let c = 0; c < COLS; c++) {
      const x = colX(c);
      // A chevron per empty slot: the capture marks every column you may shoot into, which is
      // what tells a new player the bottom row is five targets and not one cannon.
      strip.fillStyle(0xffffff, 0.16);
      strip.fillTriangle(x - 9, LAUNCH_Y + 5, x + 9, LAUNCH_Y + 5, x, LAUNCH_Y - 6);
    }
  }

  private buildHud(): void {
    const pauseBtn = this.add.container(HUD.pause.x, HUD.pause.y);
    const pg = this.add.graphics();
    const s = HUD.pause.size;
    pg.fillStyle(UI.panel, 1).fillRoundedRect(-s / 2, -s / 2, s, s, 16);
    pg.lineStyle(2, UI.panelEdge, 1).strokeRoundedRect(-s / 2, -s / 2, s, s, 16);
    pg.fillStyle(0xffffff, 0.85).fillRect(-11, -14, 8, 28).fillRect(3, -14, 8, 28);
    pauseBtn.add(pg);
    pauseBtn.setSize(s, s).setInteractive({ useHandCursor: true });
    pauseBtn.on("pointerup", () => this.openPause());

    panel(this, HUD.score.x, HUD.score.y, 236, 76, 20);
    this.scoreText = txt(this, HUD.score.x, HUD.score.y - 10, "0", 50);
    this.bestText = txt(this, HUD.score.x, HUD.score.y + 24, `BEST ${save.best}`, 20, UI.inkDim);

    // The goal badge: the next tile value that has never been made. It is the only long-term
    // target the game has, so it sits in the corner with the score rather than behind a menu.
    this.goalTile = this.add
      .image(HUD.goal.x, HUD.goal.y, tileKey(this.goalValue()))
      .setScale((HUD.goal.size / CELL) * this.TS);
    this.goalLabel = txt(this, HUD.goal.x, HUD.goal.y + HUD.goal.size / 2 + 12, "Locked", 19, UI.inkDim);

    coinIcon(this, HUD.coin.x, HUD.coin.y, 16);
    this.coinText = txt(this, HUD.coin.x + 24, HUD.coin.y, "0", 32).setOrigin(0, 0.5);

    txt(this, HUD.next.label, HUD.next.y, "NEXT", 17, UI.inkDim).setOrigin(0, 0.5);

    this.buildBoosters();

    this.ghost = this.add.graphics().setDepth(4);
    this.ghostTile = this.add
      .image(0, 0, tileKey(2))
      .setScale(this.TS)
      .setAlpha(0.28)
      .setDepth(3)
      .setVisible(false);

    // The hint sits *under* the aiming ghost, so the moment the player starts aiming their own
    // choice is the one on top — even in the frame before `hideHint` runs.
    this.hintG = this.add.graphics().setDepth(2).setVisible(false);
    this.hintTile = this.add
      .image(0, 0, tileKey(2))
      .setScale(this.TS)
      .setAlpha(0.22)
      .setDepth(2)
      .setVisible(false);
    this.hintArrow = this.add.graphics().setDepth(2).setVisible(false);
    this.hintArrow.fillStyle(0xffdd7a, 0.95).fillTriangle(-15, 12, 15, 12, 0, -12);
  }

  private buildBoosters(): void {
    const defs: Array<{ price: number; glyph: (g: Phaser.GameObjects.Graphics) => void; run: () => void }> = [
      {
        // Hammer — smash one tile.
        price: PRICE_HAMMER,
        glyph: (g) => {
          g.fillStyle(0xb845dd, 1).fillRoundedRect(-16, -14, 32, 14, 5);
          g.fillStyle(0x7b5cf0, 1).fillRoundedRect(-4, -2, 8, 20, 3);
        },
        run: () => this.armHammer(),
      },
      {
        // Swap — reroll the tile in the launcher.
        price: PRICE_SWAP,
        glyph: (g) => {
          g.lineStyle(5, 0xf4562a, 1);
          g.beginPath();
          g.arc(0, 0, 13, Math.PI * 0.15, Math.PI * 1.6);
          g.strokePath();
          g.fillStyle(0xf4562a, 1).fillTriangle(11, -12, 20, -4, 8, 1);
        },
        run: () => this.doSwap(),
      },
      {
        // Undo — take the last shot back.
        price: PRICE_UNDO,
        glyph: (g) => {
          g.lineStyle(5, 0x4a6cf7, 1);
          g.beginPath();
          g.arc(2, 2, 12, Math.PI * 1.15, Math.PI * 0.35);
          g.strokePath();
          g.fillStyle(0x4a6cf7, 1).fillTriangle(-14, -10, -2, -6, -12, 4);
        },
        run: () => this.doUndo(),
      },
    ];

    const size = HUD.boosters.size;
    defs.forEach((def, i) => {
      const x = HUD.boosters.right - (defs.length - 1 - i) * HUD.boosters.gap;
      const y = HUD.boosters.y - 6;
      const root = this.add.container(x, y);
      const g = this.add.graphics();
      g.fillStyle(UI.panel, 1).fillRoundedRect(-size / 2, -size / 2, size, size, 16);
      g.lineStyle(2, UI.panelEdge, 1).strokeRoundedRect(-size / 2, -size / 2, size, size, 16);
      const icon = this.add.graphics();
      def.glyph(icon);
      root.add([g, icon]);
      root.setSize(size, size).setInteractive({ useHandCursor: true });
      root.on("pointerup", () => {
        if (this.modal || this.busy) return;
        if (this.coins < def.price) {
          sfx.deny();
          this.flash(x, y, "Not enough coins");
          return;
        }
        def.run();
      });

      coinIcon(this, x - 20, y + size / 2 + 12, 8);
      this.boosterLabels.push(
        txt(this, x - 8, y + size / 2 + 12, String(def.price), 18, UI.inkDim).setOrigin(0, 0.5),
      );
    });
  }

  private buildLauncher(): void {
    this.launchTile = this.add
      .image(colX(this.launchCol), LAUNCH_Y, tileKey(2))
      .setScale(this.TS * 0.82)
      .setDepth(6);
    // The on-deck tile, small, up in the HUD. Knowing the next value is what turns a shot from
    // a reaction into a two-move plan, and it costs one sprite.
    //
    // ⚠ It sits in the HUD and not beside the launcher, which is where it started. Down there
    // it landed on top of the fifth column's chevron — so the rightmost lane looked occupied,
    // and the preview looked like a sixth slot you could shoot from.
    this.nextTile = this.add
      .image(HUD.next.x, HUD.next.y, tileKey(2))
      .setScale(this.TS * 0.44)
      .setDepth(6)
      .setAlpha(0.9);
  }

  // ── HUD refresh ────────────────────────────────────────────────────────────

  private goalValue(): number {
    return this.bestTile < 512 ? 512 : this.bestTile * 2;
  }

  private refreshHud(): void {
    // ⚠ Not `scoreText.setText` — `update()` owns that label so the number rolls up. Setting it
    // here as well makes the total snap first and then roll to the same place, twice per chain.
    this.bestText.setText(`BEST ${Math.max(save.best, this.score)}`);
    this.coinText.setText(String(this.coins));
    this.goalTile.setTexture(tileKey(this.goalValue()));
    this.goalTile.setScale((HUD.goal.size / CELL) * this.TS);
    this.goalLabel.setText("Locked");
  }

  private refreshLauncher(animate = true): void {
    this.launchTile.setTexture(tileKey(this.current));
    this.launchTile.setScale(this.TS * 0.82);
    this.nextTile.setTexture(tileKey(this.next));
    this.nextTile.setScale(this.TS * 0.44);
    if (animate) {
      this.launchTile.setScale(this.TS * 0.4);
      this.tweens.add({
        targets: this.launchTile,
        scaleX: this.TS * 0.82,
        scaleY: this.TS * 0.82,
        duration: 160,
        ease: "Back.easeOut",
      });
    }
  }

  /**
   * Wash the columns that are one row from the bottom in red.
   *
   * ⚠ Per column, not one border round the whole well. The player's next decision is *which
   * column to avoid*, and a board-wide alarm answers a question nobody asked while hiding the
   * one that matters.
   */
  private paintDanger(): void {
    this.trackFx.clear();
    for (let c = 0; c < COLS; c++) {
      const h = columnHeight(this.board, c);
      if (h < ROWS - 1) continue;
      const alpha = h >= ROWS ? 0.3 : 0.16;
      this.trackFx
        .fillStyle(UI.danger, alpha)
        .fillRoundedRect(BOARD_X + c * PITCH, BOARD_Y, CELL, BOARD_H, 14);
    }
  }

  // ── sprites ────────────────────────────────────────────────────────────────

  private addSprite(id: number, value: number, row: number, col: number): Phaser.GameObjects.Image {
    const img = this.add
      .image(colX(col), rowY(row), tileKey(value))
      .setScale(this.TS)
      .setDepth(5);
    this.tiles.set(id, img);
    return img;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  // ── input ──────────────────────────────────────────────────────────────────

  private bindInput(): void {
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      unlockAudio();
      // ⚠ Before every other branch, including the modal one. This is the only place that sees
      // *all* touches — booster buttons, the pause button, a stray tap on the chrome — and any
      // of them means the player is present and does not need to be prodded.
      this.idleMs = 0;
      this.hideHint();
      if (this.modal || this.over) return;

      if (this.armed === "hammer") {
        this.hammerAt(p.worldX, p.worldY);
        return;
      }
      if (this.busy) return;
      // Only the well and the launcher strip aim. Everything above BOARD_Y is HUD, and a
      // mis-grab there must not queue up a shot that fires when the finger lifts.
      if (p.worldY < BOARD_Y - 16 || p.worldY > LAUNCH_Y + LAUNCH_H) return;
      this.aiming = true;
      this.updateAim(p.worldX);
    });

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.aiming) return;
      this.updateAim(p.worldX);
    });

    this.input.on("pointerup", () => {
      if (!this.aiming) return;
      this.aiming = false;
      this.clearGhost();
      void this.shoot(this.aimCol);
    });

    // A pointer that leaves the canvas mid-drag never sends `pointerup`, and without this the
    // ghost would hang on the board until the next tap.
    this.input.on("gameout", () => {
      this.aiming = false;
      this.clearGhost();
    });
  }

  private updateAim(worldX: number): void {
    const c = Phaser.Math.Clamp(Math.floor((worldX - BOARD_X) / PITCH), 0, COLS - 1);
    this.aimCol = c;
    const row = landingRow(this.board, c);

    this.ghost.clear();
    if (row < 0) {
      // Full column: show the lane as blocked instead of drawing a landing box nowhere.
      this.ghostTile.setVisible(false);
      this.ghost.lineStyle(3, UI.danger, 0.8);
      dashedRect(this.ghost, BOARD_X + c * PITCH, BOARD_Y, CELL, BOARD_H);
    } else {
      const x = colX(c);
      const y = rowY(row);
      this.ghostTile.setTexture(tileKey(this.current)).setPosition(x, y).setVisible(true);
      this.ghost.lineStyle(3, UI.ghost, 0.75);
      dashedRect(this.ghost, x - CELL / 2, y - CELL / 2, CELL, CELL);
      // The lane the shot will travel, so the eye can follow it up from the launcher.
      this.ghost.fillStyle(UI.ghost, 0.05);
      this.ghost.fillRoundedRect(x - CELL / 2, y + CELL / 2 + GAP, CELL, BOARD_BOTTOM - y - CELL / 2, 12);
    }

    this.tweens.add({
      targets: this.launchTile,
      x: colX(c),
      duration: 90,
      ease: "Quad.easeOut",
    });
  }

  private clearGhost(): void {
    this.ghost.clear();
    this.ghostTile.setVisible(false);
  }

  // ── the shot ───────────────────────────────────────────────────────────────

  private async shoot(col: number): Promise<void> {
    if (this.busy || this.over || this.modal) return;
    const row = landingRow(this.board, col);
    if (row < 0) {
      sfx.deny();
      this.shake(this.launchTile);
      return;
    }

    this.busy = true;
    this.launchCol = col;
    this.pushUndo();

    const value = this.current;
    const id = this.idSeq++;
    const x = colX(col);

    // The flying tile is a real sprite from the start, so the thing that lands is the thing
    // that was in the launcher — no hand-off, no chance of the two disagreeing about value.
    const img = this.addSprite(id, value, ROWS, col);
    img.setPosition(x, LAUNCH_Y).setScale(this.TS * 0.82);
    this.launchTile.setVisible(false);
    sfx.shoot();

    const dist = LAUNCH_Y - rowY(row);
    const dur = Phaser.Math.Clamp(dist * 0.42, 110, 300);
    this.trail(x, LAUNCH_Y, rowY(row), value);

    await new Promise<void>((resolve) => {
      this.tweens.add({
        targets: img,
        y: rowY(row),
        scaleX: this.TS,
        scaleY: this.TS,
        duration: dur,
        ease: "Quad.easeOut",
        onComplete: () => resolve(),
      });
    });

    this.board[row][col] = { id, value };
    sfx.land();
    this.squash(img);
    // A puff of dust under the tile it hit. Most shots merge nothing, and without this they
    // land in complete silence — the squash alone is too small to register as an impact.
    const dust = this.add
      .image(x, rowY(row) + CELL * 0.44, "puff")
      .setDepth(4)
      .setAlpha(0.32);
    dust.setDisplaySize(CELL * 1.15, CELL * 0.38);
    this.tweens.add({
      targets: dust,
      alpha: 0,
      scaleX: dust.scaleX * 1.7,
      duration: 280,
      onComplete: () => dust.destroy(),
    });

    const res = settle(this.board, { row, col });
    await this.playChain(res);

    // Streak and dealer bookkeeping both run off what actually happened, never off what the
    // dealer predicted — see the note on staleness in spawn.ts.
    noteShot(this.dealer, res.steps.length);
    if (res.steps.length > 0) {
      this.streak++;
      if (this.streak >= STREAK_MIN) this.showStreak(this.streak);
    } else {
      this.streak = 0;
    }

    // Hand over the next tile only after the chain has settled, so the launcher never shows a
    // new value while the board is still moving.
    this.current = this.next;
    this.next = deal(this.board, this.dealer);
    this.launchTile.setPosition(colX(col), LAUNCH_Y).setVisible(true);
    this.refreshLauncher();
    this.paintDanger();
    this.busy = false;

    if (isFull(this.board)) this.endRun();
  }

  private async playChain(res: Resolution): Promise<void> {
    if (!res.steps.length) return;

    for (let i = 0; i < res.steps.length; i++) {
      const st = res.steps[i];
      const tx = colX(st.into.col);
      const ty = rowY(st.into.row);

      const eaten = this.tiles.get(st.eaten.id);
      if (eaten) {
        this.tiles.delete(st.eaten.id);
        this.tweens.add({
          targets: eaten,
          x: tx,
          y: ty,
          scaleX: this.TS * 0.5,
          scaleY: this.TS * 0.5,
          alpha: 0.2,
          duration: 110,
          ease: "Quad.easeIn",
          onComplete: () => eaten.destroy(),
        });
      }
      await this.wait(110);

      const into = this.tiles.get(st.into.id);
      if (into) {
        into.setTexture(tileKey(st.into.value)).setScale(this.TS);
        this.pop(into);
      }
      // Each merge in a chain hits harder than the last: more sparks, a wider ring, and the
      // points for *that* merge floating off the cell it happened in. Without the per-step
      // payoff a ten-merge chain is nine silent frames and one number at the end.
      this.burst(tx, ty, st.into.value, i);
      this.ring(tx, ty, st.into.value, i);
      // ⚠ Offset off the cell, not centred on it. Centred, the "+3" lands exactly on top of the
      // tile's own baked digits and both become unreadable at the one moment they matter.
      this.floatAt(
        tx + CELL * 0.46,
        ty - CELL * 0.36,
        `+${mergePoints(st.into.value)}`,
        26 + Math.min(i, 5) * 3,
      );
      sfx.merge(i);

      // Bystanders sliding up, plus the merged tile itself if the slide moved it too.
      const moves = st.falls.slice();
      if (st.at.row !== st.into.row || st.at.col !== st.into.col) {
        moves.push({ id: st.into.id, row: st.at.row, col: st.at.col });
      }
      for (const m of moves) {
        const sp = this.tiles.get(m.id);
        if (!sp) continue;
        this.tweens.add({
          targets: sp,
          x: colX(m.col),
          y: rowY(m.row),
          duration: 110,
          ease: "Quad.easeOut",
        });
      }
      await this.wait(moves.length ? 110 : 70);
    }

    // Scoring, once, after the chain — a running total that ticked up per step would be
    // unreadable during the exact half-second the player is watching the board.
    const combo = res.steps.length;
    const mult = combo >= COMBO_MIN ? 1 + (combo - COMBO_MIN + 1) * 0.5 : 1;
    const gained = Math.round(res.points * mult);
    this.score += gained;

    const earned = Math.max(0, combo - 1) * COIN_PER_COMBO_STEP;
    this.coins += earned;

    // The praise banner. One word, one punch, sized and coloured by how big the chain was.
    const praise = praiseFor(combo);
    if (praise) {
      this.banner(praise.word, praise.size, praise.tint);
      if (praise.shake > 0) this.cameras.main.shake(180 + combo * 12, praise.shake);
      if (combo >= COMBO_MIN) sfx.combo();
    }
    // The multiplier is a separate, smaller line under the word: the word says "well done",
    // the number says "and here is what it was worth". Collapsing them into one string loses
    // whichever half the player was not looking for.
    if (combo >= COMBO_MIN) this.subBanner(`COMBO x${combo}`);
    // ⚠ The screen-wide flash rides the *same threshold as the shake*, not the combo threshold.
    // Both are the entire display reacting at once, and if one of them is too loud for an
    // ordinary three-chain then so is the other — splitting them just moves the noise.
    if (praise && praise.shake > 0) this.whiteOut(Math.min(0.06 + combo * 0.012, 0.22));

    if (res.best > this.bestTile) {
      const jump = res.best;
      this.bestTile = jump;
      save.bestTile = jump;
      this.coins += COIN_PER_NEW_BEST_TILE;
      // A new highest tile is the only genuinely rare event in a run, so it gets the loudest
      // treatment in the game and it gets it on its own, after the chain's own banner.
      this.time.delayedCall(260, () => {
        this.banner(`${jump}  NEW BEST`, 46, 0xffb020);
        if (jump >= SHAKE_BEST_TILE) this.cameras.main.shake(300, 0.013);
        this.whiteOut(0.28);
        this.coinFly(GAME_W / 2, BOARD_Y + BOARD_H * 0.4, 8);
      });
    }

    if (earned > 0) {
      this.coinFly(colX(res.steps[combo - 1].at.col), rowY(res.steps[combo - 1].at.row), Math.min(earned, 6));
    }

    save.coins = this.coins;
    if (this.score > save.best) save.best = this.score;
    this.refreshHud();
    this.floatScore(gained);
  }

  // ── boosters ───────────────────────────────────────────────────────────────

  private armHammer(): void {
    this.armed = "hammer";
    sfx.buy();
    this.flash(GAME_W / 2, BOARD_Y - 40, "Tap a tile to smash", 0xffffff);
    this.clearGhost();
    this.ghost.lineStyle(3, 0xb845dd, 0.7);
    dashedRect(this.ghost, BOARD_X - 6, BOARD_Y - 6, BOARD_W + 12, BOARD_H + 12);
  }

  private hammerAt(worldX: number, worldY: number): void {
    const c = Math.floor((worldX - BOARD_X) / PITCH);
    const r = Math.floor((worldY - BOARD_Y) / PITCH);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    const t = this.board[r][c];
    if (!t) return;

    this.armed = "none";
    this.clearGhost();
    this.coins -= PRICE_HAMMER;
    save.coins = this.coins;
    this.pushUndo();

    const sp = this.tiles.get(t.id);
    this.tiles.delete(t.id);
    if (sp) {
      this.burst(sp.x, sp.y, t.value);
      this.tweens.add({
        targets: sp,
        scaleX: this.TS * 1.4,
        scaleY: this.TS * 1.4,
        alpha: 0,
        duration: 160,
        onComplete: () => sp.destroy(),
      });
    }

    // Punching a hole out of the middle of a stack drops everything under it — same gravity
    // the merge path uses, so the two never disagree about where a column ends up.
    this.board[r][c] = null;
    let write = 0;
    for (let rr = 0; rr < ROWS; rr++) {
      const tile = this.board[rr][c];
      if (!tile) continue;
      if (rr !== write) {
        this.board[write][c] = tile;
        this.board[rr][c] = null;
        const s = this.tiles.get(tile.id);
        if (s) this.tweens.add({ targets: s, y: rowY(write), duration: 130, ease: "Quad.easeOut" });
      }
      write++;
    }

    sfx.buy();
    this.refreshHud();

    // A hole in the middle of a stack is gravity, and gravity can push two equals together —
    // so a smash resolves through exactly the same settle as a shot does.
    this.busy = true;
    void this.wait(170).then(async () => {
      await this.playChain(settle(this.board));
      this.paintDanger();
      this.busy = false;
      if (isFull(this.board)) this.endRun();
    });
  }

  private doSwap(): void {
    this.coins -= PRICE_SWAP;
    save.coins = this.coins;
    this.current = bestSwap(this.board, this.current);
    this.refreshLauncher();
    this.refreshHud();
    sfx.buy();
    this.flash(colX(this.launchCol), LAUNCH_Y - 70, `${this.current}`, 0xffdd7a);
  }

  private doUndo(): void {
    const snap = this.undoStack.pop();
    if (!snap) {
      sfx.deny();
      this.flash(GAME_W / 2, BOARD_Y - 40, "Nothing to undo");
      return;
    }
    this.coins = snap.coins - PRICE_UNDO;
    this.restore(snap);
    save.coins = this.coins;
    sfx.buy();
  }

  private pushUndo(): void {
    this.undoStack.push({
      values: toValues(this.board),
      score: this.score,
      coins: this.coins,
      current: this.current,
      next: this.next,
      launchCol: this.launchCol,
    });
    // One shot back is all the button promises. Keeping a deep history would let a player walk
    // an entire lost board backwards for 20 coins a step, which is not a booster, it is a
    // rewind — and it would quietly make the score meaningless.
    if (this.undoStack.length > 1) this.undoStack.shift();
  }

  private restore(snap: Snapshot): void {
    for (const sp of this.tiles.values()) sp.destroy();
    this.tiles.clear();

    this.board = fromValues(snap.values, () => this.idSeq++);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const t = this.board[r][c];
        if (t) this.addSprite(t.id, t.value, r, c);
      }

    this.score = snap.score;
    // An undo is a correction, not an achievement — the counter snaps rather than rolling.
    this.shownScore = snap.score;
    this.scoreText.setText(String(snap.score));
    this.current = snap.current;
    this.next = snap.next;
    this.launchCol = snap.launchCol;
    this.over = false;
    this.launchTile.setPosition(colX(this.launchCol), LAUNCH_Y).setVisible(true);
    this.refreshLauncher(false);
    this.refreshHud();
    this.paintDanger();
  }

  // ── effects ────────────────────────────────────────────────────────────────

  private pop(img: Phaser.GameObjects.Image): void {
    this.tweens.add({
      targets: img,
      scaleX: this.TS * 1.22,
      scaleY: this.TS * 1.22,
      duration: 90,
      yoyo: true,
      ease: "Quad.easeOut",
    });
  }

  private squash(img: Phaser.GameObjects.Image): void {
    img.setScale(this.TS * 1.1, this.TS * 0.86);
    this.tweens.add({
      targets: img,
      scaleX: this.TS,
      scaleY: this.TS,
      duration: 150,
      ease: "Back.easeOut",
    });
  }

  private shake(obj: Phaser.GameObjects.Image): void {
    const x0 = obj.x;
    this.tweens.add({
      targets: obj,
      x: x0 + 8,
      duration: 45,
      yoyo: true,
      repeat: 2,
      onComplete: () => obj.setX(x0),
    });
  }

  private trail(x: number, fromY: number, toY: number, value: number): void {
    const sw = swatch(value);
    const g = this.add.image(x, (fromY + toY) / 2, "puff").setDepth(2);
    g.setDisplaySize(CELL * 0.9, Math.abs(fromY - toY));
    g.setTint(sw.light).setAlpha(0.28);
    this.tweens.add({ targets: g, alpha: 0, duration: 320, onComplete: () => g.destroy() });
  }

  /**
   * The merge pop. `power` is the merge's index in the chain, and everything scales off it —
   * a chain has to visibly *build*, or the tenth merge looks exactly like the first and the
   * player has no way to feel the difference between a lucky tap and a great one.
   */
  private burst(x: number, y: number, value: number, power = 0): void {
    const sw = swatch(value);
    const heat = Math.min(power, 8);

    const flash = this.add.image(x, y, "puff").setDepth(7).setTint(sw.light).setAlpha(0.85);
    flash.setDisplaySize(CELL * (1.5 + heat * 0.1), CELL * (1.5 + heat * 0.1));
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: flash.scaleX * 1.5,
      scaleY: flash.scaleY * 1.5,
      duration: 260,
      onComplete: () => flash.destroy(),
    });

    const n = 6 + heat * 2;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const d = 34 + heat * 5 + Math.random() * 26;
      const s = this.add
        .image(x, y, "spark")
        .setDepth(8)
        .setTint(i % 3 === 0 ? 0xffffff : sw.light)
        .setScale(this.TS * (0.8 + heat * 0.06));
      this.tweens.add({
        targets: s,
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        alpha: 0,
        scaleX: this.TS * 0.3,
        scaleY: this.TS * 0.3,
        duration: 300 + heat * 20,
        ease: "Quad.easeOut",
        onComplete: () => s.destroy(),
      });
    }
  }

  /** An expanding hoop at the merge point — the cheapest possible "that mattered". */
  private ring(x: number, y: number, value: number, power = 0): void {
    const sw = swatch(value);
    const g = this.add.graphics().setDepth(7).setPosition(x, y);
    g.lineStyle(4, sw.light, 0.9).strokeCircle(0, 0, CELL * 0.4);
    const to = 1.5 + Math.min(power, 6) * 0.22;
    this.tweens.add({
      targets: g,
      scaleX: to,
      scaleY: to,
      alpha: 0,
      duration: 340,
      ease: "Quad.easeOut",
      onComplete: () => g.destroy(),
    });
  }

  /**
   * The praise word: snaps in oversized, holds, leaves upward.
   *
   * ⚠ `Back.easeOut` from a 2.2x scale, not a fade-in. The whole point of the word is that it
   * arrives *on* the beat of the merge that earned it; anything that ramps in over 300ms lands
   * after the moment it is supposed to be reacting to and reads as unrelated UI.
   */
  private banner(word: string, size: number, tint: number): void {
    const y = BOARD_Y + BOARD_H * 0.36;
    const t = txt(this, GAME_W / 2, y, word, size, "#" + tint.toString(16).padStart(6, "0"))
      .setDepth(40)
      .setAlpha(0);
    t.setScale(2.2);
    t.setShadow(0, 5, "#00000099", 10, false, true);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 190, ease: "Back.easeOut" });
    this.tweens.add({
      targets: t,
      y: y - 52,
      alpha: 0,
      delay: 560,
      duration: 320,
      ease: "Quad.easeIn",
      onComplete: () => t.destroy(),
    });
  }

  /** The quieter second line under the praise word — the multiplier, not the compliment. */
  private subBanner(text: string): void {
    const y = BOARD_Y + BOARD_H * 0.36 + 52;
    const t = txt(this, GAME_W / 2, y, text, 28, UI.ink).setDepth(40).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 140, delay: 90 });
    this.tweens.add({
      targets: t,
      alpha: 0,
      y: y - 34,
      delay: 620,
      duration: 300,
      onComplete: () => t.destroy(),
    });
  }

  /** A full-screen white pulse. Kept low and short — this is a punctuation mark, not a strobe. */
  private whiteOut(alpha: number): void {
    const g = this.add.graphics().setDepth(45);
    g.fillStyle(0xffffff, 1).fillRect(0, 0, GAME_W, GAME_H);
    g.setAlpha(alpha);
    this.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  /**
   * Coins flying from the board into the wallet.
   *
   * ⚠ They have to physically travel to the counter. A coin total that just increments is a
   * number changing somewhere the player is not looking — the arc is the only thing that
   * connects "I made a combo" to "I can afford the hammer".
   */
  private coinFly(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const c = coinIcon(this, 0, 0, 11).setDepth(42);
      c.setPosition(x + (Math.random() - 0.5) * 44, y + (Math.random() - 0.5) * 44);
      this.tweens.add({
        targets: c,
        x: HUD.coin.x,
        y: HUD.coin.y,
        duration: 380 + i * 50,
        delay: i * 45,
        ease: "Quad.easeIn",
        onComplete: () => {
          c.destroy();
          this.pop2(this.coinText);
        },
      });
    }
  }

  /** The slower reward loop: shots in a row that each did something. */
  private showStreak(n: number): void {
    const y = BOARD_BOTTOM - 46;
    const t = txt(this, GAME_W / 2, y, `${n} IN A ROW`, 30, "#ffdd7a").setDepth(40).setAlpha(0);
    t.setScale(1.6);
    this.tweens.add({ targets: t, alpha: 1, scale: 1, duration: 170, ease: "Back.easeOut" });
    this.tweens.add({
      targets: t,
      alpha: 0,
      y: y - 30,
      delay: 620,
      duration: 300,
      onComplete: () => t.destroy(),
    });
  }

  private flash(x: number, y: number, text: string, tint = 0xffffff): void {
    const t = txt(this, x, y, text, 34, "#" + tint.toString(16).padStart(6, "0")).setDepth(30);
    t.setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: y - 18, duration: 160, ease: "Quad.easeOut" });
    this.tweens.add({
      targets: t,
      alpha: 0,
      y: y - 60,
      delay: 520,
      duration: 300,
      onComplete: () => t.destroy(),
    });
  }

  /** A small "+n" rising off a cell. Used per merge, so it has to stay cheap and quiet. */
  private floatAt(x: number, y: number, text: string, size: number): void {
    const t = txt(this, x, y, text, size, "#ffffff").setDepth(32);
    t.setShadow(0, 3, "#00000099", 6, false, true);
    this.tweens.add({
      targets: t,
      y: y - 44,
      alpha: 0,
      duration: 520,
      ease: "Quad.easeOut",
      onComplete: () => t.destroy(),
    });
  }

  private floatScore(gained: number): void {
    if (gained <= 0) return;
    const t = txt(this, HUD.score.x + 96, HUD.score.y - 10, `+${gained}`, 30, "#7ee2a8").setDepth(30);
    this.tweens.add({
      targets: t,
      y: HUD.score.y - 52,
      alpha: 0,
      duration: 620,
      onComplete: () => t.destroy(),
    });
    this.pop2(this.scoreText);
  }

  private pop2(t: Phaser.GameObjects.Text): void {
    this.tweens.add({ targets: t, scale: 1.15, duration: 90, yoyo: true });
  }

  // ── the hint ───────────────────────────────────────────────────────────────

  /**
   * Mark the column `bestColumn` picks for the tile currently in the launcher.
   *
   * Three marks, because the player who needs this does not yet know where to look: the lane is
   * washed, the landing cell gets a dashed box with a faded copy of the tile in it, and an arrow
   * bobs at the foot of the lane where the tap goes. Any one of them alone is a decoration
   * someone stuck has already stared past.
   */
  private showHint(): void {
    const pick = bestColumn(this.board, this.current);
    if (pick.col < 0) return;
    const row = landingRow(this.board, pick.col);
    if (row < 0) return;

    const x = colX(pick.col);
    const y = rowY(row);

    this.hintG.clear();
    this.hintG.fillStyle(0xffdd7a, 0.07);
    this.hintG.fillRoundedRect(BOARD_X + pick.col * PITCH, BOARD_Y, CELL, BOARD_H, 14);
    this.hintG.lineStyle(3, 0xffdd7a, 0.85);
    dashedRect(this.hintG, x - CELL / 2, y - CELL / 2, CELL, CELL);
    this.hintG.setVisible(true).setAlpha(0);

    this.hintTile.setTexture(tileKey(this.current)).setPosition(x, y).setVisible(true);
    this.hintArrow.setPosition(x, BOARD_BOTTOM - 26).setVisible(true).setAlpha(0);

    this.hintOn = true;
    this.hintTweens = [
      this.tweens.add({
        targets: [this.hintG, this.hintArrow],
        alpha: 1,
        duration: 260,
        ease: "Quad.easeOut",
      }),
      // The breathing pulse only starts once it has faded in, so the first thing the player
      // sees is the mark arriving rather than the middle of a cycle.
      this.tweens.add({
        targets: [this.hintG, this.hintArrow],
        alpha: 0.45,
        delay: 260,
        duration: 620,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      }),
      this.tweens.add({
        targets: this.hintArrow,
        y: BOARD_BOTTOM - 40,
        duration: 480,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      }),
    ];
  }

  private hideHint(): void {
    if (!this.hintOn) return;
    this.hintOn = false;
    for (const t of this.hintTweens) t.stop();
    this.hintTweens = [];
    this.hintG.clear().setVisible(false).setAlpha(1);
    this.hintTile.setVisible(false);
    this.hintArrow.setVisible(false).setAlpha(1);
  }

  /**
   * Per-frame housekeeping: the rolling score, then the idle timer behind the hint.
   *
   * ⚠ The score chase is a frame loop rather than a tween on purpose. Chains land in bursts and
   * a tween per burst means several of them fighting over the same label, which shows up as the
   * number jumping backwards. A single chase cannot disagree with itself.
   */
  update(_time: number, delta: number): void {
    if (this.shownScore !== this.score) {
      const gap = this.score - this.shownScore;
      const step = Math.max(1, Math.ceil(Math.abs(gap) * (delta / 90)));
      this.shownScore += Math.sign(gap) * Math.min(step, Math.abs(gap));
      this.scoreText.setText(String(this.shownScore));
    }

    // Idle only counts while a shot is actually available. Time spent watching a chain resolve,
    // reading the pause sheet or lining up an aim is not the player being stuck, and counting
    // it would pop the hint open the instant a long combo finished.
    const canMove =
      !this.busy && !this.modal && !this.over && !this.aiming && this.armed === "none";
    if (!canMove) {
      this.idleMs = 0;
      this.hideHint();
      return;
    }
    this.idleMs += delta;
    if (!this.hintOn && this.idleMs >= HINT_DELAY_MS) this.showHint();
  }

  // ── sheets ─────────────────────────────────────────────────────────────────

  private sheet(height: number): Phaser.GameObjects.Container {
    this.modal = true;
    this.aiming = false;
    this.clearGhost();

    const root = this.add.container(0, 0).setDepth(50);
    const dim = this.add.graphics();
    dim.fillStyle(0x000000, 0.65).fillRect(0, 0, GAME_W, GAME_H);
    dim.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, GAME_W, GAME_H),
      Phaser.Geom.Rectangle.Contains,
    );
    root.add(dim);

    const card = this.add.graphics();
    const w = 440;
    const y = GAME_H / 2 - height / 2;
    card.fillStyle(UI.panel, 1).fillRoundedRect((GAME_W - w) / 2, y, w, height, 28);
    card.lineStyle(3, UI.panelEdge, 1).strokeRoundedRect((GAME_W - w) / 2, y, w, height, 28);
    root.add(card);
    return root;
  }

  private openPause(): void {
    if (this.modal || this.busy) return;
    const root = this.sheet(420);
    const top = GAME_H / 2 - 210;

    root.add(txt(this, GAME_W / 2, top + 60, "PAUSED", 52));
    const soundBtn = button(
      this,
      GAME_W / 2,
      top + 150,
      300,
      74,
      save.muted ? "SOUND: OFF" : "SOUND: ON",
      () => {
        save.muted = !save.muted;
        soundBtn.label.setText(save.muted ? "SOUND: OFF" : "SOUND: ON");
      },
      0x3a3752,
    );
    const resume = button(this, GAME_W / 2, top + 244, 300, 74, "RESUME", () => {
      root.destroy(true);
      this.modal = false;
    });
    const home = button(this, GAME_W / 2, top + 338, 300, 74, "HOME", () => {
      this.scene.start("Home");
    }, 0x3a3752);

    root.add([soundBtn.root, resume.root, home.root]);
  }

  private endRun(): void {
    this.over = true;
    sfx.over();
    if (this.score > save.best) save.best = this.score;

    const root = this.sheet(500);
    const top = GAME_H / 2 - 250;

    root.add(txt(this, GAME_W / 2, top + 62, "GAME OVER", 50, "#ff8098"));
    root.add(txt(this, GAME_W / 2, top + 128, String(this.score), 72));
    root.add(txt(this, GAME_W / 2, top + 178, `BEST ${save.best}`, 24, UI.inkDim));

    const canRevive = this.coins >= PRICE_REVIVE;
    const revive = button(
      this,
      GAME_W / 2,
      top + 258,
      320,
      78,
      `REVIVE  ${PRICE_REVIVE}`,
      () => {
        if (this.coins < PRICE_REVIVE) {
          sfx.deny();
          return;
        }
        this.coins -= PRICE_REVIVE;
        save.coins = this.coins;
        root.destroy(true);
        this.modal = false;
        this.doRevive();
      },
      canRevive ? 0x22c55e : 0x3a3752,
    );
    revive.setEnabled(canRevive);

    const retry = button(this, GAME_W / 2, top + 350, 320, 78, "PLAY AGAIN", () => {
      this.scene.restart();
    });
    const home = button(this, GAME_W / 2, top + 440, 320, 70, "HOME", () => {
      this.scene.start("Home");
    }, 0x3a3752);

    root.add([revive.root, retry.root, home.root]);
  }

  /** Shave `REVIVE_ROWS` off the bottom of every stack and carry on with the same score. */
  private doRevive(): void {
    for (let c = 0; c < COLS; c++) {
      const h = columnHeight(this.board, c);
      for (let r = Math.max(0, h - REVIVE_ROWS); r < h; r++) {
        const t = this.board[r][c];
        if (!t) continue;
        const sp = this.tiles.get(t.id);
        this.tiles.delete(t.id);
        if (sp) {
          this.burst(sp.x, sp.y, t.value);
          this.tweens.add({
            targets: sp,
            alpha: 0,
            scaleX: this.TS * 1.3,
            scaleY: this.TS * 1.3,
            duration: 220,
            onComplete: () => sp.destroy(),
          });
        }
        this.board[r][c] = null;
      }
    }
    this.over = false;
    this.busy = false;
    this.refreshHud();
    this.paintDanger();
  }

  /**
   * Console handle: `__game.scene.getScene('Game').debugState()`.
   *
   * ⚠ `scripts/shot.mjs` reads this to pick a column, so it is not dead code — dropping a field
   * turns the screenshot harness into a random tapper that dies in twenty shots and photographs
   * an almost-empty board.
   */
  debugState(): {
    board: number[];
    score: number;
    max: number;
    current: number;
    next: number;
    over: boolean;
    busy: boolean;
  } {
    return {
      board: toValues(this.board),
      score: this.score,
      max: maxTile(this.board),
      current: this.current,
      next: this.next,
      over: this.over,
      busy: this.busy,
    };
  }
}
