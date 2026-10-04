// Intake cards (Teachers tab): download a template, upload a filled file or
// paste rows, preview what matched, then save. The markup is static in
// index.html so a half-typed paste survives re-renders; all decisions live in
// src/intake.js. Save stays disabled while any row has a problem.

import { getData, setData } from "./store.js";
import { esc } from "./dom.js";
import { getXLSX } from "../excel.js";
import { recordUndoPoint } from "./board.js";
import { templateRows, rowsFromPaste, parseIntake } from "../intake.js";

const FILE_NAMES = {
  formTeachers: "form-teachers-template.xlsx",
  lastYear: "last-year-teachers-template.xlsx",
  denies: "deny-list-template.xlsx",
};
const SAVED_WHAT = {
  formTeachers: "form teacher(s)",
  lastYear: "last-year row(s)",
  denies: "deny rule(s)",
};

const pending = {}; // kind -> previewed rows waiting for Save

const q = (card, role) => card.querySelector(`[data-role="${role}"]`);
const saveButton = (card) => card.querySelector('[data-action="intake-save"]');

function showPreview(card, kind, rows) {
  const result = parseIntake(kind, rows, getData());
  const box = q(card, "intake-preview");
  const save = saveButton(card);
  pending[kind] = rows;
  const lines = [];
  if (result.accepted.length === 0 && result.problems.length === 0) {
    lines.push("<p>No rows found. Paste rows or upload a filled template.</p>");
  } else {
    lines.push(
      `<p><strong>${esc(result.accepted.length)} row(s) ready</strong>${
        result.problems.length > 0
          ? `, ${esc(result.problems.length)} need fixing`
          : ""
      }.</p>`,
    );
  }
  if (result.problems.length > 0) {
    lines.push(
      `<ul class="problems">${result.problems
        .map((p) => `<li>Row ${esc(p.row)}: ${esc(p.message)}</li>`)
        .join(
          "",
        )}</ul><p>Fix these in your sheet and upload or paste it again - nothing is saved until every row matches.</p>`,
    );
  }
  box.innerHTML = lines.join("");
  save.disabled = result.problems.length > 0 || result.accepted.length === 0;
}

function downloadTemplate(kind) {
  const XLSX = getXLSX();
  const { headers, current, example } = templateRows(kind, getData());
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([headers, ...current]),
    "Template",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([headers, example]),
    "Example",
  );
  XLSX.writeFile(wb, FILE_NAMES[kind]);
}

async function readUpload(file) {
  const XLSX = getXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  // The first sheet is the one to fill in ("Template"); "Example" is ignored.
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
}

function wireIntake() {
  const root = document.getElementById("intake");
  if (!root) return;

  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    const card = e.target.closest(".intake-card");
    if (!el || !card) return;
    const kind = card.dataset.kind;
    const action = el.dataset.action;

    if (action === "intake-template") {
      try {
        downloadTemplate(kind);
      } catch (err) {
        q(card, "intake-preview").innerHTML =
          `<p class="problems">Could not make the template: ${esc(err.message)}. Reload the page and try again.</p>`;
      }
    } else if (action === "intake-upload") {
      q(card, "intake-file").click();
    } else if (action === "intake-preview") {
      showPreview(
        card,
        kind,
        rowsFromPaste(kind, q(card, "intake-paste").value),
      );
    } else if (action === "intake-save") {
      const rows = pending[kind];
      if (!rows) return;
      // Re-parse against the current data so a save never reverts edits made
      // since the preview (another list, the Board, ...).
      const result = parseIntake(kind, rows, getData());
      if (result.problems.length > 0 || result.accepted.length === 0) {
        showPreview(card, kind, rows);
        return;
      }
      recordUndoPoint(); // so Undo on the Board can reverse this
      setData(result.next);
      delete pending[kind];
      saveButton(card).disabled = true;
      q(card, "intake-paste").value = "";
      q(card, "intake-preview").innerHTML =
        `<p><strong>Saved ${esc(result.accepted.length)} ${esc(SAVED_WHAT[kind])}.</strong></p>`;
    }
  });

  root.addEventListener("input", (e) => {
    if (e.target.dataset.role !== "intake-paste") return;
    const card = e.target.closest(".intake-card");
    if (!card || !pending[card.dataset.kind]) return;
    delete pending[card.dataset.kind];
    saveButton(card).disabled = true;
    q(card, "intake-preview").innerHTML =
      "<p>You changed the pasted rows - press Check pasted rows again.</p>";
  });

  root.addEventListener("change", async (e) => {
    if (e.target.dataset.role !== "intake-file") return;
    const card = e.target.closest(".intake-card");
    const file = e.target.files[0];
    e.target.value = ""; // allow picking the same file again
    if (!file || !card) return;
    try {
      showPreview(card, card.dataset.kind, await readUpload(file));
    } catch (err) {
      delete pending[card.dataset.kind];
      saveButton(card).disabled = true;
      q(card, "intake-preview").innerHTML =
        `<p class="problems">Could not read that file: ${esc(err.message)}. Use the downloaded template and save it as .xlsx.</p>`;
    }
  });
}

export { wireIntake };
