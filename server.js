// PDF Editor - local server.
// Serves our overlay (app/) on top of the untouched pdf.js build (vendor/pdfjs/)
// and gives the viewer a way to open + save PDFs by Windows path.
// Binds to 127.0.0.1 only. Run: node server.js
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PDF_EDITOR_PORT) || 4830; // override with the PDF_EDITOR_PORT environment variable
const ROOT = __dirname;
const APP = path.join(ROOT, "app");
const WEB = path.join(ROOT, "vendor", "pdfjs", "web");
const BUILD = path.join(ROOT, "vendor", "pdfjs", "build");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ftl": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".cur": "image/x-icon",
  ".wasm": "application/wasm",
  ".pfb": "application/x-font-type1",
  ".ttf": "font/ttf",
  ".bcmap": "application/octet-stream",
  ".icc": "application/vnd.iccprofile",
  ".pdf": "application/pdf",
};

// Local files the viewer is allowed to write back to: only ones we served first.
const openedPaths = new Set();

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}
function b64urlEncode(s) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function localUrlFor(absPath) {
  return `/local/${b64urlEncode(absPath)}/${encodeURIComponent(path.basename(absPath))}`;
}
function viewerUrlFor(absPath) {
  return `/viewer.html?file=${encodeURIComponent(localUrlFor(absPath))}`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}
function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8" });
}

function serveFile(res, filePath, extraHeaders = {}) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "Not found");
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": filePath.startsWith(APP) ? "no-store" : "public, max-age=3600",
      ...extraHeaders,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Write to a temp file, then swap it over the original. On Windows the swap can
// fail for a moment with EPERM/EBUSY while the antivirus scans the new file or a
// viewer still holds the old one, so retry, then fall back to writing in place.
async function replaceFile(abs, body) {
  const tmp = abs + `.saving-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmp, body);
  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      fs.renameSync(tmp, abs);
      return;
    } catch (e) {
      lastErr = e;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) break;
      await sleep(100 + i * 50);
    }
  }
  try { fs.unlinkSync(tmp); } catch {}
  try {
    fs.writeFileSync(abs, body); // in-place: works even when the file can't be renamed over
    return;
  } catch (e2) {
    throw new Error(`Could not write ${abs}: ${e2.message} (swap also failed: ${lastErr?.code})`);
  }
}

const MAX_BODY_BYTES = 512 * 1024 * 1024; // far larger than any PDF worth editing here

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        const err = new Error("Request body is too large.");
        err.statusCode = 413;
        req.destroy();
        return reject(err);
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Only files on a local drive. A network path (\\server\share\...) would make
// this machine contact another computer just because a link was followed.
function isNetworkPath(abs) {
  return abs.startsWith("\\\\") || abs.startsWith("//");
}

// Only the editor's own page may talk to this server. Without this check any web
// page open in the same browser could ask it to read or overwrite a PDF by path.
//  - Host must be our loopback address (stops DNS rebinding).
//  - Origin, when the browser sends one, must be this server (stops cross-site POSTs).
//  - Sec-Fetch-Site, when present, must be same-origin or none. "none" is a
//    navigation the user started, which is how the launcher opens the window.
function isTrustedRequest(req) {
  const host = String(req.headers.host || "").toLowerCase();
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) return false;
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return false;
  return true;
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    // A malformed URL or an unexpected failure must not take the server down.
    const status = err instanceof URIError ? 400 : err.statusCode || 500;
    if (!res.headersSent) send(res, status, status === 400 ? "Bad request" : "Server error: " + err.message);
    else res.destroy();
  });
});

async function handle(req, res) {
  if (!isTrustedRequest(req)) return send(res, 403, "Forbidden: this server only answers its own page.");
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let p = decodeURIComponent(url.pathname);

  if (p === "/") return send(res, 302, "", { Location: "/viewer.html" });

  // /open?path=C:\...\file.pdf  -> redirect into the viewer (used by the launcher / Open with)
  if (p === "/open") {
    const target = url.searchParams.get("path") || "";
    const abs = path.resolve(target);
    if (isNetworkPath(abs)) return send(res, 403, "Network paths are not supported.");
    if (!/\.pdf$/i.test(abs) || !fs.existsSync(abs)) return send(res, 404, "PDF not found: " + abs);
    openedPaths.add(abs);
    return send(res, 302, "", { Location: viewerUrlFor(abs) });
  }

  // /local/<b64url path>/<name>.pdf : GET serves it, POST overwrites it with the request body
  const m = p.match(/^\/local\/([A-Za-z0-9_-]+)\/[^/]+$/);
  if (m) {
    let abs;
    try { abs = path.resolve(b64urlDecode(m[1])); } catch { return send(res, 400, "Bad path"); }
    if (!/\.pdf$/i.test(abs)) return send(res, 403, "Only .pdf files");
    if (isNetworkPath(abs)) return send(res, 403, "Network paths are not supported.");
    if (req.method === "GET") {
      if (!fs.existsSync(abs)) return send(res, 404, "PDF not found: " + abs);
      openedPaths.add(abs);
      return serveFile(res, abs, {
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
        "Cache-Control": "no-store",
        "X-Local-Path": encodeURIComponent(abs),
      });
    }
    if (req.method === "POST") {
      if (!openedPaths.has(abs)) return sendJson(res, 403, { ok: false, error: "This file was not opened through the editor." });
      const body = await readBody(req);
      if (body.length < 5 || body.subarray(0, 5).toString() !== "%PDF-") return sendJson(res, 400, { ok: false, error: "Body is not a PDF." });
      try {
        await replaceFile(abs, body);
        return sendJson(res, 200, { ok: true, path: abs, bytes: body.length });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }
    return send(res, 405, "Method not allowed");
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");

  // Static overlay: app/ first, then pdf.js web/, with ../build mapped to pdf.js build/
  if (p.includes("..")) return send(res, 400, "Bad path");
  if (p.startsWith("/build/")) return serveFile(res, path.join(BUILD, p.slice("/build/".length)));
  if (p.startsWith("/web/")) return serveFile(res, path.join(WEB, p.slice("/web/".length))); // worker resolves wasm/ via ../web/
  const appFile = path.join(APP, p);
  if (fs.existsSync(appFile) && fs.statSync(appFile).isFile()) return serveFile(res, appFile);
  return serveFile(res, path.join(WEB, p));
}

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    // Another PDF Editor server is already running; that is fine.
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`PDF Editor running at http://127.0.0.1:${PORT}/viewer.html`);
});

module.exports = { PORT, viewerUrlFor };
