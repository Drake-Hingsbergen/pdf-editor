// PDF Editor launcher: starts the local server if needed, then opens the editor
// in an app-style browser window. Optional argument: a .pdf path to open.
//   node launch.js ["C:\path\to\file.pdf"]
"use strict";
const { spawn, execFileSync } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PDF_EDITOR_PORT) || 4830; // override with the PDF_EDITOR_PORT environment variable
const ROOT = __dirname;
const BASE = `http://127.0.0.1:${PORT}`;

function portOpen() {
  return new Promise(resolve => {
    const s = net.connect({ port: PORT, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ensureServer() {
  if (await portOpen()) return;
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 50; i++) {
    if (await portOpen()) return;
    await sleep(100);
  }
  throw new Error("The PDF Editor server did not start on port " + PORT);
}

function findBrowser() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
  ];
  return candidates.find(p => p && fs.existsSync(p));
}

(async () => {
  await ensureServer();
  let url = `${BASE}/viewer.html`;
  const arg = process.argv.slice(2).join(" ").trim().replace(/^"|"$/g, "");
  if (arg) {
    const abs = path.resolve(arg);
    if (!fs.existsSync(abs)) throw new Error("File not found: " + abs);
    url = `${BASE}/open?path=${encodeURIComponent(abs)}`;
  }
  const browser = findBrowser();
  if (browser) {
    spawn(browser, [`--app=${url}`, "--window-size=1400,950"], { detached: true, stdio: "ignore" }).unref();
  } else {
    // Fall back to the default browser as a normal tab.
    execFileSync("cmd.exe", ["/c", "start", "", url], { windowsHide: true });
  }
})().catch(err => {
  // The launcher normally runs with no console, so show the problem in a message
  // box. The text travels in an environment variable, never in the command line.
  console.error("PDF Editor could not start: " + err.message);
  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show($env:PDF_EDITOR_ERROR, 'PDF Editor')",
      ],
      { env: { ...process.env, PDF_EDITOR_ERROR: "PDF Editor could not start:\n\n" + err.message }, windowsHide: true },
    );
  } catch {}
  process.exit(1);
});
