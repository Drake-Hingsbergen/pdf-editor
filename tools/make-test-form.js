// Generates samples/test-form.pdf: a fillable form with text fields,
// check boxes, a radio group and a signature box, for testing the editor.
// Optional helper, not needed to run the editor. It needs the pdf-lib package:
//   npm install --no-save pdf-lib@1.17.1
//   node tools/make-test-form.js
"use strict";
const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

(async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();

  page.drawText("PDF Editor test form", { x: 50, y: 730, size: 22, font: bold });
  page.drawText("Fill the fields, tick the boxes, add a note with the Text tool, sign at the bottom, then Ctrl+S.", {
    x: 50, y: 708, size: 10, font, color: rgb(0.3, 0.3, 0.3),
  });

  let y = 660;
  const textField = (name, label) => {
    page.drawText(label, { x: 50, y: y + 4, size: 11, font });
    const f = form.createTextField(name);
    f.addToPage(page, { x: 200, y: y - 4, width: 300, height: 22, borderColor: rgb(0.6, 0.6, 0.6) });
    y -= 40;
  };
  textField("fullName", "Full name");
  textField("email", "Email");
  textField("date", "Date");

  page.drawText("Options", { x: 50, y: y + 4, size: 11, font: bold });
  y -= 24;
  for (const [name, label] of [["optA", "I agree to the terms"], ["optB", "Send me a copy"], ["optC", "Notify me of changes"]]) {
    const cb = form.createCheckBox(name);
    cb.addToPage(page, { x: 60, y: y - 2, width: 16, height: 16, borderColor: rgb(0.4, 0.4, 0.4) });
    page.drawText(label, { x: 84, y, size: 11, font });
    y -= 26;
  }

  y -= 10;
  page.drawText("Choose one", { x: 50, y: y + 4, size: 11, font: bold });
  y -= 24;
  const radio = form.createRadioGroup("choice");
  for (const [val, label] of [["yes", "Yes"], ["no", "No"], ["maybe", "Maybe"]]) {
    radio.addOptionToPage(val, page, { x: 60, y: y - 2, width: 16, height: 16, borderColor: rgb(0.4, 0.4, 0.4) });
    page.drawText(label, { x: 84, y, size: 11, font });
    y -= 26;
  }

  y -= 20;
  page.drawText("Comments (no form field here - use the Text tool to write in this box)", { x: 50, y: y + 4, size: 11, font: bold });
  page.drawRectangle({ x: 50, y: y - 90, width: 512, height: 86, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 });
  y -= 130;

  page.drawText("Signature", { x: 50, y: y + 4, size: 11, font: bold });
  page.drawLine({ start: { x: 130, y: y - 20 }, end: { x: 420, y: y - 20 }, thickness: 1, color: rgb(0, 0, 0) });
  page.drawText("Date", { x: 440, y: y + 4, size: 11, font: bold });
  page.drawLine({ start: { x: 440, y: y - 20 }, end: { x: 560, y: y - 20 }, thickness: 1, color: rgb(0, 0, 0) });

  const out = path.join(__dirname, "..", "samples", "test-form.pdf");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await doc.save());
  console.log("wrote", out);
})();
