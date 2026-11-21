// PDF Editor viewer options. This is a classic script loaded before viewer.mjs;
// pdf.js fires "webviewerloaded" right before it starts, which is the supported
// moment to override its AppOptions.
document.addEventListener("webviewerloaded", () => {
  window.PDFViewerApplicationOptions.setAll({
    defaultUrl: "",                 // don't load pdf.js's sample paper
    disablePreferences: true,        // our options win over stale localStorage prefs
    enableSignatureEditor: true,     // Draw / Type / Upload signature tool
    enableUpdatedAddImage: false,    // true turns on the "Missing alt text" badge on every image
    enableAltText: false,            // no alt-text nag when adding images
    enableGuessAltText: false,
    enableNewAltTextWhenAddingImage: false,
    enableAltTextModelDownload: false,
    enableComment: false,
    enableScripting: true,           // PDF form calculations/validation
  });
});
