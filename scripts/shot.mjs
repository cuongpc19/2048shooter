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
  // ⚠ The profile is reused so Chrome starts warm, which means it also starts with a cached
  // index.html. GitHub Pages serves HTML with max-age=600, and the old hashed bundle is still
  // sitting on the branch — so a run against a fresh deploy silently photographs the *previous*
  // build and reports the new feature missing. That cost a real debugging session; leave this on.
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
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

  // ⚠ Two readiness signals, because `window.__game` is a DEV-only handle. Pointing this script
  // at a real deploy with only the `__game` check makes a perfectly healthy build look dead:
  // Phaser boots, the banner prints, the console is clean, and the script reports "never
  // booted". A canvas inside #game is the signal that works everywhere.
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    await sleep(250);
    ready = await cdp.eval(
      "return !!(window.__game && window.__game.isRunning) || !!document.querySelector('#game canvas')",
    );
  }
  if (!ready) {
    console.log(cdp.logs.join("\n"));
    throw new Error("game never booted — dev server down, or the URL is wrong?");
  }
  const hasProbe = await cdp.eval("return !!window.__game");
  if (!hasProbe) console.log("note: production build — no __game handle, tapping blind");

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

  /**
   * How many merges a shot of `value` into `col` would cascade, counting upward from the
   * bottom of the stack. Vertical only — it ignores sideways merges, so it under-counts, which
   * is the safe direction for a difficulty measurement.
   */
  const chainLen = (board, col, value) => {
    const stack = [];
    for (let r = 0; r < 8; r++) {
      const v = board[r * 5 + col];
      if (v > 0) stack.push(v);
      else break;
    }
    let v = value;
    let n = 0;
    for (let i = stack.length - 1; i >= 0 && stack[i] === v; i--) {
      v *= 2;
      n++;
    }
    return n;
  };

  /**
   * The bot: take a merge if one exists, then keep the board low, and only then prefer the
   * longer cascade.
   *
   * ⚠ The weights are in that order because both simpler policies were measured and both are
   * worse. Pure "any merge, then emptiest column" tops out at a 512 and dies at ~280 shots;
   * pure "longest cascade wins" hoards for chains, lets the board fill and dies at ~140 with a
   * 256. A difficulty harness has to run the *strongest* policy available or the numbers it
   * produces measure the bot rather than the game.
   * ⚠ Random tapping — the first version — is worse than either: it dies inside twenty shots and
   * then taps *through* the game-over sheet, silently restarting the run mid-measurement.
   */
  const pick = (board, current) => {
    let bestCol = 0;
    let bestScore = -1;
    for (let c = 0; c < 5; c++) {
      let h = 0;
      while (h < 8 && board[h * 5 + c] > 0) h++;
      if (h >= 8) continue;
      const chain = chainLen(board, c, current);
      const s = (chain > 0 ? 1000 : 0) + (8 - h) * 10 + chain;
      if (s > bestScore) {
        bestScore = s;
        bestCol = c;
      }
    }
    return bestCol;
  };

  const taps = Number(arg("taps", 10));
  let state = null;
  let survived = 0;
  for (let i = 0; i < taps; i++) {
    state = hasProbe ? await readState() : null;
    if (hasProbe && (!state || state.over)) break;
    survived = i + 1;
    // Tap on the launcher strip, which no overlay ever covers. A production build has no state
    // to read, so it gets random columns — enough to prove the thing plays.
    const col = state ? pick(state.board, state.current) : Math.floor(Math.random() * 5);
    await cdp.tap(70 + col * 100, 1098);
    // ⚠ The interesting frame is *during* the chain, not after it. Every praise banner, ring
    // and coin arc is gone within a second, so a screenshot taken once the board has settled
    // photographs a game with no feedback in it at all.
    if (i > 3 && i % 5 === 0 && i <= 20) {
      await sleep(300);
      await snap(`02-chain-${i}`);
    }
    // Wait on `busy` rather than on a fixed delay. A long chain plus a pressure row can run past
    // any delay short enough to make a 500-shot measurement run finish this century, and a tap
    // that arrives while the scene is busy is silently dropped — so a fixed sleep does not just
    // make the run slow, it makes the shot count a lie.
    if (hasProbe) {
      for (let w = 0; w < 40; w++) {
        const s = await readState();
        if (!s || !s.busy) break;
        await sleep(70);
      }
    } else {
      await sleep(620);
    }
  }
  await sleep(700);
  await snap("03-after");

  // Sit still long enough for the idle hint to come out. HINT_DELAY_MS is 3s; the extra second
  // covers the fade-in, so this frame catches the mark at full strength rather than mid-tween.
  await sleep(4200);
  await snap("05-hint");

  // And a shot of the pause sheet, so the chrome gets looked at too.
  await cdp.tap(56, 86);
  await sleep(500);
  await snap("04-pause");

  const final = await readState();
  if (final) {
    const tiles = final.board.filter((v) => v > 0).length;
    // The run length is the difficulty measurement — everything else is a screenshot.
    console.log(
      `survived: ${survived}/${taps} shots · ${tiles}/40 tiles · max ${final.max} · score ${final.score}` +
        (final.over ? " · DIED" : " · alive"),
    );
  }
  console.log("state:", JSON.stringify(final));
  console.log(cdp.logs.length ? cdp.logs.join("\n") : "console clean ✓");
  console.log("shots:\n" + shots.join("\n"));

  ws.close();
  child.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
