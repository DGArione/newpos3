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

const { spawn } = require("node:child_process");
const path = require("node:path");

const PORT_BACKEND = Number(process.env.BACKEND_PORT) || 3001;
const PORT_WEB     = Number(process.env.PORT) || 3000;

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const sep = "─".repeat(60);

console.log(`\n🧡  Golden POS — launching\n${sep}`);
console.log(`   • Backend API  →  http://localhost:${PORT_BACKEND}`);
console.log(`   • Golden POS UI →  http://localhost:${PORT_WEB}\n${sep}\n`);

// ── Backend (Express + SQLite) ──────────────────────────────────────
const backend = spawn(npm, ["start"], {
  cwd: path.join(__dirname, "backend"),
  env: { ...process.env, PORT: String(PORT_BACKEND) },
  stdio: ["inherit", "inherit", "inherit"],
  shell: true,
});

backend.on("error", (err) => {
  console.error("Backend failed to start:", err.message);
  process.exit(1);
});

// ── Next.js UI (built-in dev server; auto-recompiles on edits) ──────
// Delay the UI startup a touch so the backend has a chance to seed the DB.
setTimeout(() => {
  const web = spawn(npm, ["run", "dev"], {
    cwd: path.join(__dirname, "web"),
    env: {
      ...process.env,
      PORT: String(PORT_WEB),
      BACKEND_URL: `http://localhost:${PORT_BACKEND}`,
    },
    stdio: ["inherit", "inherit", "inherit"],
    shell: true,
  });

  web.on("error", (err) => {
    console.error("Next.js UI failed to start:", err.message);
  });

  web.on("exit", (code) => {
    console.log(`\nUI exited (code ${code}). Stopping backend.`);
    backend.kill();
    process.exit(code || 0);
  });
}, 2500);

// Clean shutdown
function shutdown() {
  console.log("\n🧡  Stopping Golden POS…");
  backend.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
