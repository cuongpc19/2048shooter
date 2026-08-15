import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = fileURLToPath(new URL(".", import.meta.url));

// Build stamp derived from git so it bumps itself every commit (no manual edits).
// Falls back to package.json when git isn't available (e.g. a stripped tarball).
function buildVersion(): { version: string; build: string } {
  try {
    const count = execSync("git rev-list --count HEAD", { cwd: root }).toString().trim();
    const hash = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
    return { version: `0.0.${count}`, build: hash };
  } catch {
    try {
      const pkg = JSON.parse(readFileSync(root + "package.json", "utf8"));
      return { version: String(pkg.version ?? "0.0.0"), build: "local" };
    } catch {
      return { version: "0.0.0", build: "local" };
    }
  }
}
const VERSION = buildVersion();

// base: "./" keeps asset paths relative — required so the same build works when it is
// served from a subfolder (GitHub Pages) or from file:// inside a native wrapper.
export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(VERSION.version),
    __APP_BUILD__: JSON.stringify(VERSION.build),
  },
  server: {
    // host: true so the dev server is reachable from a phone on the same wifi —
    // this is a portrait touch game and it has to be played on a real phone.
    host: true,
    port: 5173,
    allowedHosts: [".trycloudflare.com"],
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
  },
});
