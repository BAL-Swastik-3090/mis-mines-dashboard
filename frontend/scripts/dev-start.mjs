/**
 * Safe dev-server launcher for Kaliapani Mines Dashboard.
 *
 * Every `npm run dev` automatically:
 *  1. Kills every process listening on port 3333 (zombie guard)
 *  2. Clears .next/cache (prevents stale-module 404s on Turbopack)
 *  3. Starts `next dev -p 3333`
 */

import { execSync, spawn } from "child_process";
import { rmSync, existsSync } from "fs";
import { createServer } from "net";

const PORT = 3333;

// ── 1. Kill any existing listeners on PORT ─────────────────────
function killPort(port) {
  return new Promise((resolve) => {
    const tester = createServer();

    tester.once("error", () => {
      // Port in use — find all PIDs and kill them
      console.log(`[dev-start] Port ${port} busy — killing old process...`);
      try {
        const out = execSync("netstat -ano", { encoding: "utf8" });
        const pids = new Set();
        for (const line of out.split("\n")) {
          if (line.includes(`:${port}`) && line.includes("LISTENING")) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && pid !== "0") pids.add(pid);
          }
        }
        for (const pid of pids) {
          try {
            execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
            console.log(`[dev-start] Killed PID ${pid}`);
          } catch (_) { /* already gone */ }
        }
      } catch (_) { /* netstat unavailable */ }

      // Close test server then wait 1.5s for OS to release the port
      tester.close(() => setTimeout(resolve, 1500));
    });

    tester.once("listening", () => {
      // Port is free — nothing to kill
      tester.close(resolve);
    });

    tester.listen(port, "0.0.0.0");
  });
}

// ── 2. Clear Turbopack cache ───────────────────────────────────
function clearCache() {
  const cacheDir = ".next/cache";
  if (existsSync(cacheDir)) {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
      console.log("[dev-start] Turbopack cache cleared");
    } catch (_) { /* non-fatal */ }
  }
}

// ── 3. Start Next.js dev server ────────────────────────────────
function startNext() {
  console.log(`[dev-start] Starting Next.js on http://localhost:${PORT}\n`);
  const child = spawn("npx next dev -p " + PORT, [], {
    stdio: "inherit",
    shell: true,
    cwd: process.cwd(),
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT",  () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

// ── Run ────────────────────────────────────────────────────────
await killPort(PORT);
clearCache();
startNext();
