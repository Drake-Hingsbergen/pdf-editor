// Smoke test for the local server. Starts server.js on a spare port, then checks
// static serving, the generated viewer page, opening a PDF by path, saving it
// back, and the guards on the save route. Needs "node tools/setup.js" first.
//   node tools/smoke-test.js
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PDF_EDITOR_TEST_PORT) || 4899;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`);
  }
}

// A minimal one-page PDF with correct cross-reference offsets.
function makePdf(text) {
  const stream = `BT /F1 18 Tf 40 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// Raw request so the path and headers are sent exactly as written (fetch would
// normalise the path and does not allow setting Host, Origin or Sec-Fetch-Site).
function rawRequest(rawPath, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: rawPath, method, headers }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const rawGet = rawPath => rawRequest(rawPath);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${BASE}/editor.css`);
      return;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  throw new Error("server did not start on port " + PORT);
}

async function run() {
  console.log("Static files");
  let res = await fetch(`${BASE}/`, { redirect: "manual" });
  check("/ redirects to the viewer", res.status === 302 && res.headers.get("location") === "/viewer.html");

  res = await fetch(`${BASE}/viewer.html`);
  const html = await res.text();
  check("viewer page is served", res.status === 200);
  for (const marker of ["editor-config.js", "editor.mjs", "editor.css", "editorCheckmarkButton", "editorSaveAsButton", 'id="editorSaveAs"', "<title>PDF Editor</title>"]) {
    check(`viewer page contains ${marker}`, html.includes(marker));
  }
  check("options script loads before the pdf.js viewer", html.indexOf("editor-config.js") < html.indexOf('src="viewer.mjs"'));

  const statics = [
    ["/editor.mjs", "text/javascript"],
    ["/editor-config.js", "text/javascript"],
    ["/editor.css", "text/css"],
    ["/images/toolbarButton-checkmark.svg", "image/svg+xml"],
    ["/images/toolbarButton-saveas.svg", "image/svg+xml"],
    ["/viewer.mjs", "text/javascript"],
    ["/viewer.css", "text/css"],
    ["/build/pdf.mjs", "text/javascript"],
    ["/build/pdf.worker.mjs", "text/javascript"],
    ["/web/wasm/qcms_bg.wasm", "application/wasm"],
    ["/locale/locale.json", "application/json"],
  ];
  for (const [p, type] of statics) {
    res = await fetch(BASE + p);
    await res.arrayBuffer();
    check(`GET ${p}`, res.status === 200 && (res.headers.get("content-type") || "").startsWith(type), `${res.status} ${res.headers.get("content-type")}`);
  }
  res = await fetch(`${BASE}/no-such-file.txt`);
  check("unknown file returns 404", res.status === 404);
  const traversal = await rawGet("/..%2Fserver.js");
  check("path traversal is refused", traversal.status === 400 && !traversal.body.includes("createServer"), String(traversal.status));

  console.log("Open and save by path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-editor-test-"));
  try {
    const file = path.join(dir, "sample document.pdf");
    const original = makePdf("original");
    fs.writeFileSync(file, original);

    res = await fetch(`${BASE}/open?path=${encodeURIComponent(file)}`, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    check("/open redirects into the viewer", res.status === 302 && location.startsWith("/viewer.html?file="));
    const localUrl = decodeURIComponent(location.split("file=")[1] || "");
    check("viewer link points at a /local/ URL ending in the file name", /^\/local\/[A-Za-z0-9_-]+\/sample%20document\.pdf$/.test(localUrl), localUrl);

    res = await fetch(BASE + localUrl);
    const served = Buffer.from(await res.arrayBuffer());
    check("the PDF is served unchanged", res.status === 200 && served.equals(original));
    check("the PDF is served with its file name", (res.headers.get("content-disposition") || "").includes("sample%20document.pdf"));

    const edited = makePdf("edited and saved");
    res = await fetch(BASE + localUrl, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: edited });
    const saved = await res.json();
    check("save returns ok", res.status === 200 && saved.ok === true && saved.bytes === edited.length);
    check("the file on disk now holds the saved bytes", fs.readFileSync(file).equals(edited));
    check("no temporary files are left behind", fs.readdirSync(dir).length === 1, fs.readdirSync(dir).join(", "));

    res = await fetch(BASE + localUrl, { method: "POST", body: Buffer.from("this is not a pdf") });
    check("a body that is not a PDF is rejected", res.status === 400);
    check("the rejected save did not change the file", fs.readFileSync(file).equals(edited));

    const neverOpened = path.join(dir, "never-opened.pdf");
    fs.writeFileSync(neverOpened, original);
    const b64 = Buffer.from(neverOpened, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    res = await fetch(`${BASE}/local/${b64}/never-opened.pdf`, { method: "POST", body: edited });
    check("saving to a file the editor never opened is refused", res.status === 403);
    check("that file is untouched", fs.readFileSync(neverOpened).equals(original));

    const txt = path.join(dir, "notes.txt");
    fs.writeFileSync(txt, "hello");
    const b64txt = Buffer.from(txt, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    res = await fetch(`${BASE}/local/${b64txt}/notes.txt`);
    check("files that are not .pdf are refused", res.status === 403);

    res = await fetch(`${BASE}/open?path=${encodeURIComponent(path.join(dir, "missing.pdf"))}`, { redirect: "manual" });
    check("opening a missing file returns 404", res.status === 404);

    console.log("Requests from other sites");
    const localPath = localUrl; // already percent-encoded
    const before = fs.readFileSync(file);
    const attack = makePdf("written by another site");

    let r = await rawRequest("/viewer.html", { headers: { Host: "attacker.example" } });
    check("a request with a foreign Host header is refused", r.status === 403, String(r.status));

    r = await rawRequest(`/open?path=${encodeURIComponent(neverOpened)}`, { headers: { "Sec-Fetch-Site": "cross-site" } });
    check("a cross-site link to /open is refused", r.status === 403, String(r.status));

    const neverUrl = `/local/${b64}/never-opened.pdf`;
    r = await rawRequest(neverUrl, { headers: { "Sec-Fetch-Site": "cross-site" } });
    check("a cross-site read of a PDF is refused", r.status === 403 && !r.body.startsWith("%PDF-"), String(r.status));
    r = await rawRequest(neverUrl, { method: "POST", body: attack });
    check("the refused read did not unlock that file for saving", r.status === 403 && fs.readFileSync(neverOpened).equals(original), String(r.status));

    r = await rawRequest(localPath, { method: "POST", headers: { Origin: "https://attacker.example", "Content-Type": "text/plain" }, body: attack });
    check("a cross-origin POST to an opened file is refused", r.status === 403, String(r.status));
    check("the opened file is unchanged after the cross-origin POST", fs.readFileSync(file).equals(before));

    r = await rawRequest(localPath, { method: "POST", headers: { Origin: "null" }, body: attack });
    check("a POST from an opaque origin (Origin: null) is refused", r.status === 403, String(r.status));
    r = await rawRequest("/viewer.html", { headers: { "Sec-Fetch-Site": "same-site" } });
    check("a same-site request from another local port is refused", r.status === 403, String(r.status));

    r = await rawRequest(`/open?path=${encodeURIComponent("\\\\fileserver.example\\share\\report.pdf")}`);
    check("a network path is refused by /open", r.status === 403, String(r.status));
    const uncB64 = Buffer.from("\\\\fileserver.example\\share\\report.pdf", "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    r = await rawRequest(`/local/${uncB64}/report.pdf`);
    check("a network path is refused by /local", r.status === 403, String(r.status));

    r = await rawRequest("/%E0%A4%A");
    check("a malformed URL returns 400", r.status === 400, String(r.status));
    r = await rawRequest("/editor.css");
    check("the server is still running after the malformed URL", r.status === 200, String(r.status));

    r = await rawRequest(localPath, { method: "POST", headers: { Origin: BASE, "Sec-Fetch-Site": "same-origin" }, body: before });
    check("the editor page's own save (same origin) still works", r.status === 200, String(r.status));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, "vendor", "pdfjs", "web", "viewer.mjs")) || !fs.existsSync(path.join(ROOT, "app", "viewer.html"))) {
    console.error('pdf.js is not set up yet. Run "node tools/setup.js" first.');
    process.exit(2);
  }
  const server = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: { ...process.env, PDF_EDITOR_PORT: String(PORT) },
    stdio: "ignore",
  });
  try {
    await waitForServer();
    await run();
  } catch (err) {
    failed++;
    console.error("Test run stopped: " + err.message);
  } finally {
    server.kill();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
