// Shared chrome helpers. Nothing here knows the rules — it draws panels, labels and buttons in
// design units and hands them back.

import Phaser from "phaser";
import { UI } from "./config";

/**
 * A text object at the design-unit size, rendered at device resolution.
 *
 * ⚠ `setResolution(dpr)` is not optional. Phaser renders text into its own canvas at 1x and the
 * camera then blows it up by the device pixel ratio, so without this every label on a modern
 * phone is a blurred version of itself while the baked tile art beside it stays sharp.
 */
export function txt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size: number,
  color: string = UI.ink,
): Phaser.GameObjects.Text {
  const dpr = (scene.registry.get("dpr") as number) || 1;
  return scene.add
    .text(x, y, text, {
      fontFamily: '"Lilita One", Arial, sans-serif',
      fontSize: `${size}px`,
      color,
    })
    .setResolution(dpr)
    .setOrigin(0.5);
}

export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 18,
  fill = UI.panel,
  edge = UI.panelEdge,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(fill, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, radius);
  g.lineStyle(2, edge, 1).strokeRoundedRect(x - w / 2, y - h / 2, w, h, radius);
  return g;
}

export interface Button {
  root: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  setEnabled(on: boolean): void;
}

/**
 * A pill button.
 *
 * The press feedback is a scale dip rather than a colour swap: a finger covers the button it is
 * pressing, so a colour change under the fingertip is invisible while a size change shows at
 * the edges.
 */
export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  tint = 0x4a6cf7,
): Button {
  const root = scene.add.container(x, y);
  const g = scene.add.graphics();
  g.fillStyle(tint, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2.6);
  g.fillStyle(0xffffff, 0.16).fillRoundedRect(-w / 2 + 6, -h / 2 + 5, w - 12, h * 0.34, h / 4);
  const t = txt(scene, 0, 1, label, Math.round(h * 0.42));
  root.add([g, t]);

  let enabled = true;
  root.setSize(w, h).setInteractive({ useHandCursor: true });
  root.on("pointerdown", () => {
    if (!enabled) return;
    scene.tweens.add({ targets: root, scale: 0.94, duration: 70, yoyo: true });
  });
  root.on("pointerup", () => {
    if (enabled) onClick();
  });

  return {
    root,
    label: t,
    setEnabled(on: boolean) {
      enabled = on;
      root.setAlpha(on ? 1 : 0.45);
    },
  };
}

/**
 * A dashed rounded rectangle — the landing preview.
 *
 * Phaser has no dash support, so the sides are drawn as segments. Worth the twenty lines: a
 * solid outline reads as a real tile already sitting there, and the whole job of this marker is
 * to say "nothing is here yet, but this is where it goes".
 */
export function dashedRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  dash = 12,
  gap = 9,
): void {
  const seg = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(d + dash, len);
      g.beginPath();
      g.moveTo(x1 + ux * d, y1 + uy * d);
      g.lineTo(x1 + ux * e, y1 + uy * e);
      g.strokePath();
    }
  };
  seg(x, y, x + w, y);
  seg(x + w, y, x + w, y + h);
  seg(x + w, y + h, x, y + h);
  seg(x, y + h, x, y);
}

/** The coin glyph: a small gold hexagon. Drawn, not loaded — it appears in three places. */
export function coinIcon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  r: number,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  g.fillStyle(UI.gold, 1).fillPoints(
    pts.reduce<Phaser.Geom.Point[]>((acc, _v, i, arr) => {
      if (i % 2 === 0) acc.push(new Phaser.Geom.Point(arr[i], arr[i + 1]));
      return acc;
    }, []),
    true,
  );
  g.fillStyle(0xffffff, 0.35).fillCircle(x - r * 0.25, y - r * 0.3, r * 0.28);
  return g;
}
