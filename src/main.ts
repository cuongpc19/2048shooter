import Phaser from "phaser";
import { GAME_W, GAME_H, UI } from "./game/config";
import { GameScene } from "./scenes/GameScene";
import { HomeScene } from "./scenes/HomeScene";

// Warm the game font before Phaser bakes any canvas texture — a texture baked with a font that
// has not finished loading keeps the fallback shape forever, and every tile's digits are baked.
try {
  void document.fonts?.load('32px "Lilita One"');
} catch {
  /* no Font Loading API — the font still swaps in when ready */
}

// Wipe saved progress from a phone, where there is no DevTools console: ?reset=1
(() => {
  try {
    const p = new URLSearchParams(location.search);
    if (!p.get("reset")) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith("s2048_"))
      .forEach((k) => localStorage.removeItem(k));
    p.delete("reset");
    const qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  } catch {
    /* storage unavailable */
  }
})();

async function boot(): Promise<void> {
  // Fonts must be in before the first bake. 3s cap so a font that never arrives costs a
  // fallback rather than a blank screen.
  try {
    await Promise.race([
      document.fonts?.ready,
      new Promise((res) => setTimeout(res, 3000)),
    ]);
  } catch {
    /* ignore */
  }

  // Render at the device pixel ratio so the baked tile art stays crisp, capped at 2 — a 3x
  // canvas is 2.25x the fragments per frame for no visible gain on a flat 2D board.
  const DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    // The canvas is the design box times the pixel ratio; each scene's camera then zooms by
    // the same factor, so every coordinate in the codebase is a design unit and nothing has
    // to reason about real pixels.
    width: Math.round(GAME_W * DPR),
    height: Math.round(GAME_H * DPR),
    backgroundColor: "#" + UI.bg.toString(16).padStart(6, "0"),
    render: { powerPreference: "low-power", antialias: true },
    // Hard-cap at 60: on a 120Hz phone Phaser would otherwise render twice as often as the
    // game is designed for, doubling heat for nothing.
    fps: { target: 60, limit: 60 },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [HomeScene, GameScene],
  });

  game.registry.set("dpr", DPR);

  game.events.once("ready", () => {
    const boot = document.getElementById("boot");
    if (boot) {
      boot.classList.add("hide");
      setTimeout(() => boot.remove(), 400);
    }
  });

  if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
}

void boot();
