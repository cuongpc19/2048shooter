// Persistence. One namespace prefix (`s2048_`) so a stray `?reset=1` can find everything the
// game owns without touching anything else on the origin.

const PREFIX = "s2048_";

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    // Private mode on iOS throws on every access rather than returning null. The game has to
    // stay playable there, it just forgets everything between sessions.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* storage full or blocked — a lost save is not worth a crash */
  }
}

function num(key: string, fallback: number): number {
  const raw = read(key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const save = {
  get best(): number {
    return num("best", 0);
  },
  set best(v: number) {
    write("best", String(Math.max(0, Math.floor(v))));
  },

  /** Highest tile ever reached, across all runs — what the corner badge unlocks against. */
  get bestTile(): number {
    return num("bestTile", 0);
  },
  set bestTile(v: number) {
    write("bestTile", String(Math.max(0, Math.floor(v))));
  },

  /** Highest stage ever *cleared*. 0 means nobody has built a 1024 yet. */
  get bestStage(): number {
    return num("bestStage", 0);
  },
  set bestStage(v: number) {
    write("bestStage", String(Math.max(0, Math.floor(v))));
  },

  get coins(): number {
    return num("coins", -1);
  },
  set coins(v: number) {
    write("coins", String(Math.max(0, Math.floor(v))));
  },

  get muted(): boolean {
    return read("muted") === "1";
  },
  set muted(v: boolean) {
    write("muted", v ? "1" : "0");
  },

  clear(): void {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* storage unavailable */
    }
  },
};
