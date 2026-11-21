// PDF Editor overlay on top of the stock pdf.js viewer.
// Adds: welcome drop zone, Open via the native file picker, Save that writes
// back to the file you opened (Ctrl+S), Save as... (Ctrl+Shift+S), toasts.
// Viewer options live in editor-config.js (must run before viewer.mjs starts).
import { PDFViewerApplication as App } from "./viewer.mjs";

const PDF_TYPES = [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }];
const hasFSAccess = "showOpenFilePicker" in window && "showSaveFilePicker" in window;

// ---- state ------------------------------------------------------------------
let fileHandle = null;        // FileSystemFileHandle of the open doc (drop / picker)
let pendingHandle = null;     // promise resolving to the handle for the doc being opened
let localPath = null;         // Windows path when opened through the server (/local/...)
let saveAsRequested = false;

// ---- small UI helpers -------------------------------------------------------
let toastEl, toastTimer;
function toast(msg, kind = "ok", ms = 3500) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.id = "editorToast";
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.dataset.kind = kind;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
}
function fileNameOf(p) {
  return p.split(/[\\/]/).pop();
}

// ---- welcome / drop zone ----------------------------------------------------
let welcome;
function buildWelcome() {
  welcome = document.createElement("div");
  welcome.id = "editorWelcome";
  welcome.innerHTML = `
    <div class="card">
      <div class="logo" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="72" height="72">
          <path d="M14 4h26l12 12v40a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#e5484d"/>
          <path d="M40 4v12h12" fill="#ff8a8e"/>
          <text x="32" y="44" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="700" font-size="17" fill="#fff">PDF</text>
        </svg>
      </div>
      <h1>Drop a PDF here</h1>
      <p>or</p>
      <button id="editorWelcomeOpen" type="button" class="primary">Open a PDF…</button>
      <ul class="hints">
        <li><b>Fill forms</b>: click fields and check boxes directly on the page</li>
        <li><b>Add text</b>: <kbd>T</kbd> tool in the toolbar, click where you want it</li>
        <li><b>Tick a printed box</b>: <b>✔</b> tool, then click each box (Esc when done)</li>
        <li><b>Sign</b>: signature tool in the toolbar: draw, type or upload one (kept for next time)</li>
        <li><b>Save</b>: <kbd>Ctrl</kbd>+<kbd>S</kbd> writes back to the same file, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> saves a copy</li>
      </ul>
    </div>`;
  document.getElementById("viewerContainer").append(welcome);
  welcome.querySelector("#editorWelcomeOpen").addEventListener("click", openWithPicker);
}
function showWelcome(show) {
  welcome?.classList.toggle("hidden", !show);
}

// ---- open -------------------------------------------------------------------
async function openWithPicker() {
  if (!hasFSAccess) {
    realFileInput?.click();
    return;
  }
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({ types: PDF_TYPES, multiple: false });
  } catch (e) {
    if (e.name !== "AbortError") toast("Could not open the file picker: " + e.message, "error");
    return;
  }
  await openHandle(handle);
}
async function openHandle(handle) {
  try {
    const file = await handle.getFile();
    pendingHandle = Promise.resolve(handle);
    localPath = null;
    await App.open({ url: URL.createObjectURL(file), originalUrl: encodeURIComponent(file.name) });
  } catch (e) {
    toast("Could not open file: " + e.message, "error");
  }
}

// Capture the file-system handle of a dropped PDF before pdf.js opens it.
document.getElementById("mainContainer").addEventListener(
  "drop",
  evt => {
    const file = evt.dataTransfer?.files?.[0];
    const item = evt.dataTransfer?.items?.[0];
    if (!file || file.type !== "application/pdf") return;
    localPath = null;
    pendingHandle = item?.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(() => null) : null;
  },
  true,
);

// ---- save -------------------------------------------------------------------
async function writeToHandle(handle, data) {
  if (handle.queryPermission && (await handle.queryPermission({ mode: "readwrite" })) !== "granted") {
    if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") {
      throw new Error("Write permission was not granted");
    }
  }
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
}
async function saveToLocalPath(data) {
  const url = App.baseUrl || App.url;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: data });
  const json = await res.json().catch(() => ({ ok: false, error: res.statusText }));
  if (!json.ok) throw new Error(json.error || "Save failed");
  return json;
}
async function saveWithPicker(data, suggestedName) {
  let handle;
  try {
    handle = await window.showSaveFilePicker({ types: PDF_TYPES, suggestedName });
  } catch (e) {
    if (e.name === "AbortError") return null;
    throw e;
  }
  await writeToHandle(handle, data);
  return handle;
}

function installSaveHook() {
  const dm = App.downloadManager;
  if (!dm) return;
  const original = dm.download.bind(dm);
  dm.download = async (data, url, filename) => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const wantsPicker = saveAsRequested;
    saveAsRequested = false;
    try {
      if (!hasFSAccess && !localPath) return original(data, url, filename);

      if (!wantsPicker && localPath) {
        try {
          const r = await saveToLocalPath(bytes);
          toast(`Saved ${fileNameOf(r.path)} (${(r.bytes / 1024).toFixed(0)} KB)`);
          return;
        } catch (e) {
          console.warn("Saving back to the opened file failed, asking where to save instead:", e);
          toast(`Couldn't overwrite ${fileNameOf(localPath)} (${e.message}). Choose where to save it.`, "error", 5000);
          if (!hasFSAccess) return original(data, url, filename);
        }
      }
      if (!wantsPicker && fileHandle) {
        try {
          await writeToHandle(fileHandle, bytes);
          toast(`Saved ${fileHandle.name} (${(bytes.length / 1024).toFixed(0)} KB)`);
          return;
        } catch (e) {
          console.warn("Saving to the opened file failed, asking where to save instead:", e);
        }
      }
      if (!hasFSAccess) return original(data, url, filename);
      const h = await saveWithPicker(bytes, filename || "document.pdf");
      if (!h) return; // cancelled
      fileHandle = h;
      localPath = null;
      App._contentDispositionFilename = h.name;
      App.setTitle(h.name);
      toast(`Saved ${h.name} (${(bytes.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      console.error(e);
      toast("Save failed: " + e.message, "error", 6000);
    }
  };
}

function saveAs() {
  if (!App.pdfDocument) return;
  saveAsRequested = true;
  App.secondaryToolbar?.close?.();
  App.downloadOrSave();
}

// ---- checkmark tool ---------------------------------------------------------
// Scanned forms have no real check boxes. This tool puts a small tick image
// (a standard Stamp annotation, so every viewer shows it) wherever you click.
const CHECK_SIZE_PT = 11;        // size of the tick on the page, in PDF points
const STAMP_MODE = 13;           // AnnotationEditorType.STAMP
let checkMode = false;
let checkDataUrl = null;

function makeCheckImage() {
  const px = 128;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const ctx = c.getContext("2d");
  ctx.lineWidth = px * 0.14;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#111";
  ctx.beginPath();
  ctx.moveTo(px * 0.14, px * 0.55);
  ctx.lineTo(px * 0.40, px * 0.82);
  ctx.lineTo(px * 0.88, px * 0.20);
  ctx.stroke();
  return c.toDataURL("image/png");
}

function setCheckMode(on) {
  checkMode = on;
  document.getElementById("editorCheckmarkButton")?.classList.toggle("toggled", on);
  document.getElementById("viewer")?.classList.toggle("checkmarkMode", on);
  if (on && App.pdfViewer.annotationEditorMode !== STAMP_MODE) {
    App.pdfViewer.annotationEditorMode = { mode: STAMP_MODE };
    hideStampUi();
  } else if (on) {
    hideStampUi();
  } else if (!on && App.pdfViewer.annotationEditorMode === STAMP_MODE) {
    App.pdfViewer.annotationEditorMode = { mode: 0 };
  }
}

function placeCheckmark(evt) {
  const layerDiv = evt.target;
  const pageDiv = layerDiv.closest(".page");
  if (!pageDiv) return;
  const pageView = App.pdfViewer.getPageView(Number(pageDiv.dataset.pageNumber) - 1);
  const layer = pageView?.annotationEditorLayer?.annotationEditorLayer;
  if (!layer) return;
  checkDataUrl ||= makeCheckImage();
  const { width: layerPx } = layerDiv.getBoundingClientRect();
  const [pageWpt, pageHpt] = layer.pageDimensions;
  const pxPerPt = layerPx / pageWpt;
  const half = (CHECK_SIZE_PT * pxPerPt) / 2;
  const editor = layer.createAndAddNewEditor(
    { offsetX: evt.offsetX - half, offsetY: evt.offsetY - half },
    false,
    { bitmapUrl: checkDataUrl },
  );
  if (editor) {
    editor.width = CHECK_SIZE_PT / pageWpt;
    editor.height = CHECK_SIZE_PT / pageHpt;
    // The tick is selected (handles + toolbar) once its image renders; drop
    // the selection so the next click places another one cleanly.
    const uiManager = App.pdfViewer._layerProperties?.annotationEditorUIManager;
    let tries = 0;
    const tick = () => {
      if (editor.div?.querySelector("canvas")) {
        uiManager?.unselectAll();
      } else if (tries++ < 40) {
        setTimeout(tick, 50);
      }
    };
    setTimeout(tick, 50);
  }
}

// pdf.js expands the "Add image" menu and highlights its button whenever the
// stamp mode is on; keep those closed while we are the one using that mode.
function hideStampUi() {
  document.getElementById("editorStampParamsToolbar")?.classList.add("hidden");
  const b = document.getElementById("editorStampButton");
  if (b) {
    b.classList.remove("toggled");
    b.setAttribute("aria-expanded", "false");
  }
}

function installCheckmarkTool() {
  const btn = document.getElementById("editorCheckmarkButton");
  if (!btn) return;
  btn.addEventListener("click", () => setCheckMode(!checkMode));
  // Leave check mode when any other tool is chosen (or the stamp mode ends).
  App.eventBus.on("annotationeditormodechanged", ({ mode }) => {
    if (!checkMode) return;
    if (mode !== STAMP_MODE) setCheckMode(false);
    else hideStampUi();
  });
  window.addEventListener(
    "keydown",
    e => {
      if (e.key === "Escape" && checkMode) setCheckMode(false);
    },
    true,
  );
  document.getElementById("viewer").addEventListener(
    "pointerup",
    evt => {
      if (!checkMode || evt.button !== 0) return;
      if (!evt.target.classList.contains("annotationEditorLayer")) return; // clicks on existing editors still select/move them
      placeCheckmark(evt);
      evt.stopImmediatePropagation(); // pdf.js's own stamp-mode handler would just unselect
      evt.preventDefault();
    },
    true,
  );
}

// ---- wiring -----------------------------------------------------------------
let realFileInput = null;

buildWelcome();
showWelcome(!new URLSearchParams(location.search).get("file"));

App.initializedPromise.then(() => {
  // Route pdf.js's "Open" (toolbar button + Ctrl+O) through the native picker
  realFileInput = App._openFileInput;
  App._openFileInput = { click: openWithPicker };

  installSaveHook();
  installCheckmarkTool();

  document.getElementById("editorSaveAs")?.addEventListener("click", saveAs);
  document.getElementById("editorSaveAsButton")?.addEventListener("click", saveAs);
  window.addEventListener(
    "keydown",
    e => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopImmediatePropagation();
        saveAs();
      }
    },
    true,
  );

  const { eventBus } = App;
  eventBus.on("documentloaded", async () => {
    showWelcome(false);
    const url = App.baseUrl || App.url || "";
    const m = url.match(/\/local\/([A-Za-z0-9_-]+)\//);
    if (m) {
      localPath = b64urlDecode(m[1]);
      fileHandle = null;
    } else {
      localPath = null;
      fileHandle = pendingHandle ? await pendingHandle : null;
    }
    pendingHandle = null;
    if (localPath) toast(`Opened ${fileNameOf(localPath)}. Ctrl+S saves back to it`, "info", 3000);
    else if (fileHandle) toast(`Opened ${fileHandle.name}. Ctrl+S saves back to it`, "info", 3000);
  });
  eventBus.on("documenterror", () => showWelcome(!App.pdfDocument));
});
