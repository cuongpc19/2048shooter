// Tile art, baked once at boot into canvas textures.
//
// ⚠ Baked, not drawn live. A merge chain can have a dozen tiles moving at once and each one is
// a rounded rect with a bevel and a label; rebuilding that geometry every frame is the one
// thing on this board expensive enough to drop a cheap phone below 60. Eighteen textures is
// the whole cost, paid once.
//
// ⚠ Baked at `CELL * dpr` and displayed at `CELL`. The camera zoom (see main.ts) means one
// design unit is `dpr` real pixels, so a texture baked at design size would be upscaled and the
// digits would go soft on exactly the devices that can show them best.

import Phaser from "phaser";
import { CELL, MAX_EXP, TILE_COLORS } from "./config";

export function tileKey(value: number): string {
  const exp = Math.max(1, Math.min(MAX_EXP, Math.round(Math.log2(value))));
  return `tile-${exp}`;
}

/** Digits shrink as they get longer so "131072" still fits the same square. */
function labelSize(text: string, cell: number): number {
  if (text.length <= 2) return cell * 0.42;
  if (text.length === 3) return cell * 0.34;
  if (text.length === 4) return cell * 0.27;
  if (text.length === 5) return cell * 0.22;
  return cell * 0.185;
}

function bakeTile(scene: Phaser.Scene, exp: number, dpr: number): void {
  const key = `tile-${exp}`;
  if (scene.textures.exists(key)) return;

  const size = Math.round(CELL * dpr);
  const r = Math.round(size * 0.19);
  const sw = TILE_COLORS[exp];

  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;
  const g = tex.getContext();
  g.clearRect(0, 0, size, size);

  const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

  // Body: a vertical ramp from the light tone to the base. Cheap, and it is what stops a
  // board of flat rectangles from reading as a spreadsheet.
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, hex(sw.light));
  grad.addColorStop(0.45, hex(sw.base));
  grad.addColorStop(1, hex(sw.dark));

  roundRect(g, 0, 0, size, size, r);
  g.fillStyle = grad;
  g.fill();

  // Gloss: a soft highlight across the top third, clipped to the tile.
  g.save();
  roundRect(g, 0, 0, size, size, r);
  g.clip();
  const gloss = g.createLinearGradient(0, 0, 0, size * 0.5);
  gloss.addColorStop(0, "rgba(255,255,255,0.28)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gloss;
  g.fillRect(0, 0, size, size * 0.5);
  g.restore();

  // Rim, so neighbouring tiles of similar hue still have an edge between them.
  roundRect(g, dpr * 0.5, dpr * 0.5, size - dpr, size - dpr, r);
  g.lineWidth = Math.max(1, dpr);
  g.strokeStyle = "rgba(255,255,255,0.22)";
  g.stroke();

  const text = String(Math.pow(2, exp));
  const px = Math.round(labelSize(text, size));
  g.font = `${px}px "Lilita One", Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(0,0,0,0.30)";
  g.fillText(text, size / 2, size / 2 + Math.max(1, dpr * 1.5));
  g.fillStyle = "#ffffff";
  g.fillText(text, size / 2, size / 2);

  tex.refresh();
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** A soft radial puff, tinted per use — the merge flash and the shot trail both use it. */
function bakePuff(scene: Phaser.Scene, dpr: number): void {
  const key = "puff";
  if (scene.textures.exists(key)) return;
  const size = Math.round(96 * dpr);
  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;
  const g = tex.getContext();
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  tex.refresh();
}

/** A small square spark for the merge burst. */
function bakeSpark(scene: Phaser.Scene, dpr: number): void {
  const key = "spark";
  if (scene.textures.exists(key)) return;
  const size = Math.round(14 * dpr);
  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;
  const g = tex.getContext();
  roundRect(g, 0, 0, size, size, size * 0.3);
  g.fillStyle = "#ffffff";
  g.fill();
  tex.refresh();
}

export function bakeAll(scene: Phaser.Scene, dpr: number): void {
  for (let exp = 1; exp <= MAX_EXP; exp++) bakeTile(scene, exp, dpr);
  bakePuff(scene, dpr);
  bakeSpark(scene, dpr);
}
