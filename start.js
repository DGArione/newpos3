#!/usr/bin/env node
/*
 * One-command launcher for the Golden POS experience.
 *
 *   npm start
 *
 * Starts the backend API on :3001 and the Next.js UI on :3000.
 * Open http://localhost:3000 in the browser.
 *
 * The classic plain-HTML UI is still available via:
 *   npm run start:classic         (serves at http://localhost:3000)
 */

const { spawn, execSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");

// ── Guard against a corrupt native SWC binary ──────────────────────────────
// Next.js needs an SWC binding even when Babel is configured. On Windows a
// low-disk `npm install` often truncates the native binary (".node is not a
// valid Win32 application"), which crashes `next dev`. We ship the WASM SWC
// fallback as a dependency; if the native binary is present but unloadable,
// we remove it so Next falls back to WASM cleanly.
function ensureUsableSwc() {
  const webModules = path.join(__dirname, "web", "node_modules");
  const wasmPkg = path.join(webModules, "@next", "swc-wasm-nodejs");
  const hasWasm = fs.existsSync(wasmPkg);
  // Find any installed native @next/swc-* package.
  const nextScope = path.join(webModules, "@next");
  let nativeDir = null;
  try {
    for (const name of fs.readdirSync(nextScope)) {
      if (name.startsWith("swc-") && name !== "swc-wasm-nodejs") {
        nativeDir = path.join(nextScope, name);
        break;
      }
    }
  } catch { return; }
  if (!nativeDir) return;
  // Try to load the native binding; if it throws, it's corrupt.
  let ok = true;
  try { require(nativeDir); } catch { ok = false; }
  if (ok) return;
  if (!hasWasm) {
    console.log("   ⚠ The native SWC binary looks corrupt and the WASM fallback isn't installed.");
    console.log("     Run 'npm install' inside the web/ folder (with free disk space) and try again.");
    return;
  }
  try {
    fs.rmSync(nativeDir, { recursive: true, force: true });
    console.log("   ⚠ Removed a corrupt native SWC binary — using the WASM fallback instead.");
  } catch { /* best effort */ }
}

const PORT_BACKEND = Number(process.env.BACKEND_PORT) || 3001;
const PORT_WEB     = Number(process.env.PORT) || 3000;

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const sep = "─".repeat(60);

// ── Free a stuck port from a previous run (so EADDRINUSE never blocks us) ──
function freePort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once("error", () => {
        // Port busy — try to kill whatever is holding it.
        console.log(`   ⚠ Port ${port} is in use — freeing it…`);
        try {
          if (process.platform === "win32") {
            const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
            const pids = new Set();
            out.split(/\r?\n/).forEach((line) => {
              const m = line.trim().match(/LISTENING\s+(\d+)\s*$/);
              if (m) pids.add(m[1]);
            });
            pids.forEach((pid) => { try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); } catch {} });
          } else {
            execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: "ignore", shell: "/bin/bash" });
          }
        } catch { /* best effort */ }
        setTimeout(resolve, 600);
      })
      .once("listening", () => tester.close(resolve))
      .listen(port, "0.0.0.0");
  });
}

async function main() {
  console.log(`\n🧡  Golden POS — launching\n${sep}`);
  console.log(`   • Backend API  →  http://localhost:${PORT_BACKEND}`);
  console.log(`   • Golden POS UI →  http://localhost:${PORT_WEB}\n${sep}\n`);

  await freePort(PORT_BACKEND);
  await freePort(PORT_WEB);
  ensureUsableSwc();

  // ── Backend (Express + SQLite) ──────────────────────────────────────
  const backend = spawn(npm, ["start"], {
    cwd: path.join(__dirname, "backend"),
    env: { ...process.env, PORT: String(PORT_BACKEND) },
    stdio: ["inherit", "inherit", "inherit"],
    shell: true,
  });
  backend.on("error", (err) => console.error("Backend failed to start:", err.message));

  // ── Next.js UI (dev server) ──────────────────────────────────────
  setTimeout(() => {
    const web = spawn(npm, ["run", "dev"], {
      cwd: path.join(__dirname, "web"),
      env: { ...process.env, PORT: String(PORT_WEB), BACKEND_URL: `http://localhost:${PORT_BACKEND}` },
      stdio: ["inherit", "inherit", "inherit"],
      shell: true,
    });
    web.on("error", (err) => console.error("Next.js UI failed to start:", err.message));
    web.on("exit", (code) => {
      // Don't tear down the backend just because the UI hiccuped on first boot.
      if (code && code !== 0) {
        console.log(`\n⚠ UI exited (code ${code}). Backend is still running on :${PORT_BACKEND}.`);
        console.log(`  Fix the UI and run 'npm run dev:web' in the web/ folder, or restart with 'npm start'.`);
      }
    });
  }, 2500);

  function shutdown() {
    console.log("\n🧡  Stopping Golden POS…");
    try { backend.kill(); } catch {}
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
