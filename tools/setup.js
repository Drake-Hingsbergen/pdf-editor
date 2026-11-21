// One-time setup. Downloads the pinned pdf.js release, checks its SHA-256,
// unpacks it into vendor/pdfjs and generates app/viewer.html from the stock
// pdf.js viewer page by applying the few edits this project needs.
// pdf.js is not stored in this repository; it is fetched here.
//   node tools/setup.js
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const VERSION = "6.4.299";
const ZIP_NAME = `pdfjs-${VERSION}-dist.zip`;
const ZIP_URL = `https://github.com/mozilla/pdf.js/releases/download/v${VERSION}/${ZIP_NAME}`;
const ZIP_SHA256 = "f2245eb7ef3f674c872fe568a177bfec15874f5c034613e55d8e307f93ebd86d";

const ROOT = path.join(__dirname, "..");
const VENDOR = path.join(ROOT, "vendor", "pdfjs");
const STOCK_VIEWER = path.join(VENDOR, "web", "viewer.html");
const OUR_VIEWER = path.join(ROOT, "app", "viewer.html");

// Each edit must match the stock page exactly once. If pdf.js changes its
// markup in a later release, setup stops here instead of producing a broken page.
const INDENT = " ".repeat(18);
const EDITS = [
  {
    name: "page title",
    find: "<title>PDF.js viewer</title>",
    replace: "<title>PDF Editor</title>",
  },
  {
    name: "our stylesheet",
    find: '<link rel="stylesheet" href="viewer.css" />',
    replace: '<link rel="stylesheet" href="viewer.css" />\n    <link rel="stylesheet" href="editor.css" />',
  },
  {
    name: "our scripts",
    find: '<script src="viewer.mjs" type="module"></script>',
    replace:
      '<script src="editor-config.js"></script>\n' +
      '  <script src="viewer.mjs" type="module"></script>\n' +
      '  <script src="editor.mjs" type="module"></script>',
  },
  {
    name: "checkmark tool button",
    find: '<div id="editorFreeText" class="toolbarButtonWithContainer">',
    replace:
      '<div id="editorCheckmark" class="toolbarButtonWithContainer">\n' +
      `${INDENT}  <button id="editorCheckmarkButton" class="toolbarButton" type="button" tabindex="0" title="Checkmark - click a box on the page to tick it (Esc to stop)" aria-label="Checkmark"><span class="checkGlyph" aria-hidden="true">&#10004;</span></button>\n` +
      `${INDENT}</div>\n` +
      `${INDENT}<div id="editorFreeText" class="toolbarButtonWithContainer">`,
  },
  {
    name: "Save as button in the main toolbar",
    find:
      '<button id="downloadButton" class="toolbarButton" type="button" tabindex="0" data-l10n-id="pdfjs-save-button">\n' +
      `${INDENT}  <span data-l10n-id="pdfjs-save-button-label"></span>\n` +
      `${INDENT}</button>`,
    replace: match =>
      match +
      "\n" +
      `${INDENT}<button id="editorSaveAsButton" class="toolbarButton" type="button" tabindex="0" title="Save as\u2026 (Ctrl+Shift+S) - save a copy to a new file" aria-label="Save as">\n` +
      `${INDENT}  <span>Save as</span>\n` +
      `${INDENT}</button>`,
  },
  {
    name: "Save as entry in the overflow menu",
    find:
      '<button id="secondaryDownload" class="toolbarButton labeled" type="button" tabindex="0" data-l10n-id="pdfjs-save-button">\n' +
      `${INDENT}        <span data-l10n-id="pdfjs-save-button-label"></span>\n` +
      `${INDENT}      </button>`,
    replace: match =>
      match +
      "\n" +
      `${INDENT}    <button id="editorSaveAs" class="toolbarButton labeled" type="button" tabindex="0" title="Save a copy to a new file (Ctrl+Shift+S)">\n` +
      `${INDENT}      <span>Save as\u2026</span>\n` +
      `${INDENT}    </button>`,
  },
];

function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

async function download() {
  console.log(`Downloading ${ZIP_URL}`);
  const res = await fetch(ZIP_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  if (sha !== ZIP_SHA256) {
    throw new Error(`Checksum mismatch for ${ZIP_NAME}\n  expected ${ZIP_SHA256}\n  got      ${sha}`);
  }
  console.log(`Checksum OK (${buf.length} bytes)`);
  return buf;
}

function unpack(zipPath) {
  fs.rmSync(VENDOR, { recursive: true, force: true });
  fs.mkdirSync(VENDOR, { recursive: true });
  if (process.platform === "win32") {
    // The tar that ships with Windows reads zip files; Git's GNU tar does not.
    const winTar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    execFileSync(winTar, ["-xf", zipPath, "-C", VENDOR], { stdio: "inherit" });
  } else {
    execFileSync("unzip", ["-q", zipPath, "-d", VENDOR], { stdio: "inherit" });
  }
}

function generateViewer() {
  let html = fs.readFileSync(STOCK_VIEWER, "utf8").replace(/\r\n/g, "\n");
  for (const edit of EDITS) {
    const n = countOf(html, edit.find);
    if (n !== 1) {
      throw new Error(`Edit "${edit.name}" expected 1 match in the stock viewer page but found ${n}. pdf.js markup has changed.`);
    }
    const replacement = typeof edit.replace === "function" ? edit.replace(edit.find) : edit.replace;
    html = html.replace(edit.find, () => replacement);
  }
  fs.writeFileSync(OUR_VIEWER, html);
  console.log(`Wrote ${path.relative(ROOT, OUR_VIEWER)} (${EDITS.length} edits applied)`);
}

(async () => {
  if (fs.existsSync(STOCK_VIEWER) && !process.argv.includes("--force")) {
    console.log("vendor/pdfjs already present (use --force to download again)");
  } else {
    const buf = await download();
    const zipPath = path.join(ROOT, "vendor", ZIP_NAME);
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    fs.writeFileSync(zipPath, buf);
    try {
      unpack(zipPath);
    } finally {
      fs.rmSync(zipPath, { force: true });
    }
    console.log(`Unpacked pdf.js ${VERSION} into vendor/pdfjs`);
  }
  generateViewer();
  console.log("Setup complete. Start with: node launch.js");
})().catch(err => {
  console.error("Setup failed: " + err.message);
  process.exit(1);
});
