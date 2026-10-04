// Subjects tab: editable table of the school's subject types (name,
// discipline, stream, 2-week periods, levels offered). No auto-defaults are
// seeded here - the HOD's data already has real subjects from sample.json
// or their own entry.

import { getData, setData } from "./store.js";
import { esc, genId, isBlankNumberInput } from "./dom.js";
import { applySetupEdit } from "../setup.js";

const LEVELS = [1, 2, 3, 4, 5];

// Subjects/classes/bands all feed generateGroups() - after any edit here we
// immediately fold in rebuildGroups() so data.groups stays in sync with the
// current setup, without ever auto-solving (rebuildGroups only touches
// groups/assignments, never calls the solver). See applySetupEdit() in src/setup.js and this
// project's CLAUDE.md "Re-opening never re-solves".
//
// Also surface droppedCount in this tab's own status box -
// e.g. deleting a subject can remove groups (and their assignments) with no
// other feedback otherwise.
function setSubjectsStatus(html, kind) {
  const box = document.getElementById("subjects-status");
  if (!box) return;
  box.innerHTML = html ? `<div class="status ${kind}">${html}</div>` : "";
}

function setDataAndRegenerate(next) {
  const { data: rebuilt, droppedCount, frozen } = applySetupEdit(next);
  setData(rebuilt);
  setSubjectsStatus(
    frozen
      ? 'Your Board groups were left as they are. Press "Rebuild groups from setup" on the Classes or Bands tab if you want them to follow this change.'
      : droppedCount > 0
        ? `${esc(droppedCount)} assignment(s) were removed because their group no longer exists.`
        : "",
    "info",
  );
}

function renderSubjects() {
  const data = getData();
  const tbody = document.querySelector("#table-subjects tbody");
  if (!tbody) return;
  const subjects = data.subjects || [];

  if (subjects.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6">No subjects yet - add one, or load the sample school.</td></tr>';
    return;
  }

  tbody.innerHTML = subjects
    .map((s) => {
      const levels = Array.isArray(s.levels) ? s.levels : [];
      const levelChecks = LEVELS.map(
        (lvl) =>
          `<label><input type="checkbox" data-action="toggle-level" data-level="${esc(lvl)}" ${levels.includes(lvl) ? "checked" : ""} /> ${esc(lvl)}</label>`,
      ).join(" ");
      return `
      <tr data-id="${esc(s.id)}">
        <td><input data-field="name" value="${esc(s.name)}" placeholder="e.g. G3 SCI_PHY" /></td>
        <td><input data-field="discipline" value="${esc(s.discipline)}" style="width:6em" placeholder="PHY" /></td>
        <td><input data-field="stream" value="${esc(s.stream)}" style="width:5em" placeholder="G3" /></td>
        <td><input data-field="periods" type="number" min="1" value="${esc(s.periods)}" style="width:5em" /></td>
        <td class="level-checks">${levelChecks}</td>
        <td><button data-action="delete-subject" title="Remove subject">×</button></td>
      </tr>
    `;
    })
    .join("");
}

function wireSubjects() {
  document.getElementById("btn-add-subject").addEventListener("click", () => {
    const data = getData();
    setDataAndRegenerate({
      ...data,
      subjects: [
        ...(data.subjects || []),
        {
          id: genId("subj"),
          name: "",
          discipline: "",
          stream: "",
          periods: 1,
          levels: [],
        },
      ],
    });
  });

  const tbody = document.querySelector("#table-subjects tbody");

  tbody.addEventListener("input", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const field = e.target.dataset.field;
    if (!field) return;
    if (isBlankNumberInput(e.target)) return;
    const id = row.dataset.id;
    const data = getData();
    const subjects = data.subjects.map((s) => {
      if (s.id !== id) return s;
      if (field === "periods")
        return { ...s, periods: Number(e.target.value) || 0 };
      return { ...s, [field]: e.target.value };
    });
    setDataAndRegenerate({ ...data, subjects });
  });

  tbody.addEventListener("change", (e) => {
    if (e.target.dataset.action !== "toggle-level") return;
    const row = e.target.closest("tr");
    if (!row) return;
    const id = row.dataset.id;
    const level = Number(e.target.dataset.level);
    const checked = e.target.checked;
    const data = getData();
    const subjects = data.subjects.map((s) => {
      if (s.id !== id) return s;
      const levels = new Set(Array.isArray(s.levels) ? s.levels : []);
      if (checked) levels.add(level);
      else levels.delete(level);
      return { ...s, levels: [...levels].sort((a, b) => a - b) };
    });
    setDataAndRegenerate({ ...data, subjects });
  });

  tbody.addEventListener("click", (e) => {
    if (e.target.dataset.action !== "delete-subject") return;
    const id = e.target.closest("tr").dataset.id;
    const data = getData();
    setDataAndRegenerate({
      ...data,
      subjects: data.subjects.filter((s) => s.id !== id),
    });
  });
}

export { renderSubjects, wireSubjects };
