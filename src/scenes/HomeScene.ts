import Phaser from "phaser";
import { GAME_W, GAME_H, UI, COINS_START } from "../game/config";
import { save } from "../game/save";
import { bakeAll, tileKey } from "../game/textures";
import { txt, panel, button, coinIcon } from "../game/ui";
import { unlockAudio } from "../game/audio";

/**
 * The front door: title, best score, wallet, one button.
 *
 * It is also where the tile textures get baked, because it is the first scene that exists and
 * baking eighteen canvases mid-game would show up as a hitch on the first merge.
 */
export class HomeScene extends Phaser.Scene {
  constructor() {
    super("Home");
  }

  create(): void {
    const dpr = (this.registry.get("dpr") as number) || 1;
    this.cameras.main.setZoom(dpr).centerOn(GAME_W / 2, GAME_H / 2);

    bakeAll(this, dpr);

    // First run tops the wallet up once, so the boosters are reachable before a player has
    // ground out a combo. After that the number is whatever they have spent it down to.
    if (save.coins < 0) save.coins = COINS_START;

    this.drawBackdrop();

    // A loose stack of tiles behind the title, at the values the game actually opens on —
    // the cover art is a screenshot of the mechanic rather than a logo.
    const demo: Array<[number, number, number, number]> = [
      [2, 128, 262, -9],
      [8, 236, 232, 4],
      [32, 344, 258, -5],
      [4, 420, 236, 8],
    ];
    for (const [value, x, y, rot] of demo) {
      this.add
        .image(x, y, tileKey(value))
        .setScale(1 / dpr)
        .setAngle(rot)
        .setAlpha(0.95);
    }

    txt(this, GAME_W / 2, 430, "2048", 118);
    txt(this, GAME_W / 2, 520, "SHOOTER", 62, "#9d96c8");
    txt(this, GAME_W / 2, 592, "Shoot  ·  Stack  ·  Merge", 26, UI.inkDim);

    panel(this, GAME_W / 2, 706, 300, 96, 24);
    txt(this, GAME_W / 2, 682, "BEST", 24, UI.inkDim);
    txt(this, GAME_W / 2, 722, String(save.best), 46);

    if (save.bestTile > 0) {
      this.add
        .image(GAME_W / 2 - 128, 706, tileKey(save.bestTile))
        .setScale(0.62 / dpr);
      this.add
        .image(GAME_W / 2 + 128, 706, tileKey(save.bestTile))
        .setScale(0.62 / dpr);
    }

    const play = button(this, GAME_W / 2, 856, 300, 104, "PLAY", () => {
      unlockAudio();
      this.scene.start("Game");
    });
    this.tweens.add({
      targets: play.root,
      scaleX: 1.04,
      scaleY: 1.04,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Wallet, bottom-centre. Same glyph and same reading order as in the HUD, so the number
    // does not appear to be a different currency between the menu and the board.
    coinIcon(this, GAME_W / 2 - 46, 968, 17);
    txt(this, GAME_W / 2 + 16, 968, String(save.coins), 34).setOrigin(0, 0.5);

    txt(this, GAME_W / 2, 1108, `v${__APP_VERSION__} · ${__APP_BUILD__}`, 18, "#4a4763");

    // Any pointer counts as the gesture that lets the AudioContext start.
    this.input.once("pointerdown", unlockAudio);
  }

  /** The board's own backdrop, so the menu and the game read as one place. */
  private drawBackdrop(): void {
    const g = this.add.graphics();
    g.fillStyle(UI.bg, 1).fillRect(0, 0, GAME_W, GAME_H);
    // A soft column of glow behind the title — cheap depth, no texture.
    for (let i = 8; i > 0; i--) {
      g.fillStyle(UI.bgGlow, 0.09).fillCircle(GAME_W / 2, 380, 80 + i * 44);
    }
    g.setDepth(-10);

    // A faint hint of the well below, so the title screen has the game's silhouette in it.
    const well = this.add.graphics().setDepth(-9);
    well.fillStyle(UI.well, 0.5).fillRoundedRect(24, GAME_H - 110, GAME_W - 48, 200, 26);
    well.lineStyle(2, UI.wellEdge, 0.5).strokeRoundedRect(24, GAME_H - 110, GAME_W - 48, 200, 26);
  }
}
