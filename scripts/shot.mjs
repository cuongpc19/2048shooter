// Drive the real game in a headless browser and bring back screenshots plus whatever the
// console said. Proof that the machine draws and does not throw — the other half of reading
// the rules in logic.ts.
//
// It talks raw CDP over Node's built-in WebSocket, so there is no Playwright/Puppeteer
// download to keep working — just a Chromium already on the machine.
//
//   npm run dev            # in another terminal
//   node scripts/shot.mjs             # home screen + 10 shots
//   node scripts/shot.mjs --taps 30   # play longer
//
// Output lands in scripts/.shots/.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, ".shots");
// Not 9222: on Windows some vendor helper apps already hold that port with their own embedded
// browser, and CDP would attach to that instead.
const PORT = Number(process.env.S2048_CDP_PORT ?? 9334);
const URL_BASE = process.env.S2048_URL ?? "http://localhost:5173/";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
};

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    this.logs = [];
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.waiting.has(msg.id)) {
        this.waiting.get(msg.id)(msg);
        this.waiting.delete(msg.id);
      }
      if (msg.method === "Runtime.consoleAPICalled") {
        this.logs.push(
          `[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description).join(" "),
        );
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.logs.push(`[error] ${d.exception?.description ?? d.text}`);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: `JSON.stringify((()=>{${expr}})())`,
      awaitPromise: true,
      returnByValue: true,
    });
    const v = r.result?.result?.value;
    return v == null ? null : JSON.parse(v);
  }

  /** A tap at CSS coordinates: press, tiny hold, release — the game aims on the hold. */
  async tap(x, y) {
    const base = { x, y, button: "left", clickCount: 1, buttons: 1 };
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
    await sleep(60);
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...base });
    await sleep(40);
    await this.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased", buttons: 0 });
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const exe = BROWSERS.find((p) => existsSync(p));
  if (!exe) throw new Error("no Chromium-based browser found");

  const profile = join(OUT, "profile"); // gitignored; reused so Chrome starts warm
  const child = spawn(
    exe,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--no-first-run",
      "--disable-gpu",
      "--window-size=540,1160",
      "--hide-scrollbars",
      URL_BASE,
    ],
    { stdio: "ignore", detached: false },
  );

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const pages = (await res.json()).filter((t) => t.type === "page");
      target =
        pages.find((t) => t.url.startsWith(URL_BASE)) ??
        pages.find((t) => t.url === "about:blank") ??
        null;
    } catch {
      /* browser still starting */
    }
  }
  if (!target) throw new Error("browser never opened a usable page");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const cdp = new Cdp(ws);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  // ⚠ Pin the viewport to the design box at 1x. Without it the headless window is a few pixels
  // short of what was asked for, Scale.FIT letterboxes the canvas, and every tap below lands in
  // the wrong column — silently, because the game happily accepts the wrong column.
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 540,
    height: 1160,
    deviceScaleFactor: 1,
    mobile: false,
  });
  if (!target.url.startsWith(URL_BASE)) {
    await cdp.send("Page.navigate", { url: URL_BASE });
    await sleep(1500);
  }

  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    await sleep(250);
    ready = await cdp.eval("return !!window.__game && window.__game.isRunning");
  }
  if (!ready) {
    console.log(cdp.logs.join("\n"));
    throw new Error("game never booted — is `npm run dev` running?");
  }

  const shots = [];
  const snap = async (name) => {
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    const file = join(OUT, `${name}.png`);
    writeFileSync(file, Buffer.from(r.result.data, "base64"));
    shots.push(file);
  };

  await sleep(900); // let the HTML boot splash finish fading out
  await snap("00-home");

  // PLAY sits mid-screen; tapping it is the same gesture a player makes.
  await cdp.tap(270, 856);
  await sleep(900);
  await snap("01-board");

  const readState = () =>
    cdp.eval(
      "const s = window.__game.scene.getScene('Game'); return s && s.debugState ? s.debugState() : null;",
    );

  // A greedy bot rather than a random one: shoot at a column whose bottom tile matches the
  // launcher, otherwise at the shortest column.
  //
  // ⚠ Random tapping was the first cut and it is useless for screenshots — it dies inside
  // twenty shots, photographs an almost-empty board, and then keeps tapping *through* the
  // game-over sheet and restarts the run, so the state print comes back reading zero.
  const pick = (board, current) => {
    let bestCol = 0;
    let bestScore = -1;
    for (let c = 0; c < 5; c++) {
      let h = 0;
      while (h < 8 && board[h * 5 + c] > 0) h++;
      if (h >= 8) continue;
      const under = h > 0 ? board[(h - 1) * 5 + c] : 0;
      const s = (under === current ? 100 : 0) + (8 - h);
      if (s > bestScore) {
        bestScore = s;
        bestCol = c;
      }
    }
    return bestCol;
  };

  const taps = Number(arg("taps", 10));
  let state = null;
  for (let i = 0; i < taps; i++) {
    state = await readState();
    if (!state || state.over) break;
    // Tap on the launcher strip, which no overlay ever covers.
    await cdp.tap(70 + pick(state.board, state.current) * 100, 1098);
    await sleep(620);
    if (i === Math.floor(taps / 2)) await snap("02-mid");
  }
  await sleep(700);
  await snap("03-after");

  // And a shot of the pause sheet, so the chrome gets looked at too.
  await cdp.tap(56, 86);
  await sleep(500);
  await snap("04-pause");

  console.log("state:", JSON.stringify(await readState()));
  console.log(cdp.logs.length ? cdp.logs.join("\n") : "console clean ✓");
  console.log("shots:\n" + shots.join("\n"));

  ws.close();
  child.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
