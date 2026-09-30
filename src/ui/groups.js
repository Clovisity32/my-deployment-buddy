// Groups tab: a read-only-ish list of generated groups (from the current
// setup) with just teachersNeeded/note editable inline (round-tripped
// through groupOverrides so they survive regeneration), a fully-editable
// custom-groups table, and an explicit "Regenerate groups" button.

import { getData, setData } from "./store.js";
import { esc, genId, isBlankNumberInput } from "./dom.js";
import { rebuildGroups } from "../setup.js";

// See subjects.js for why edits here fold in rebuildGroups(). Here we also
// want the droppedCount back, to surface it in the status box.
function setDataAndRegenerate(next) {
  const { data: rebuilt, droppedCount } = rebuildGroups(next);
  setData(rebuilt);
  return droppedCount;
}

function setGroupsStatus(html, kind) {
  const box = document.getElementById("groups-status");
  if (!box) return;
  box.innerHTML = html ? `<div class="status ${kind}">${html}</div>` : "";
}

function renderGroups() {
  renderGeneratedGroups();
  renderCustomGroups();
}

function renderGeneratedGroups() {
  const data = getData();
  const container = document.getElementById("generated-groups");
  if (!container) return;
  const customIds = new Set((data.customGroups || []).map((g) => g.id));
  const generated = (data.groups || []).filter((g) => !customIds.has(g.id));
  const subjectById = new Map((data.subjects || []).map((s) => [s.id, s]));

  if (generated.length === 0) {
    container.innerHTML =
      '<p>No generated groups yet - set up subjects, classes and bands, then click "Regenerate groups" below, or load the sample school.</p>';
    return;
  }

  const levels = [...new Set(generated.map((g) => g.level))].sort(
    (a, b) => a - b,
  );

  container.innerHTML = levels
    .map((level) => {
      const rows = generated
        .filter((g) => g.level === level)
        .map((g) => {
          const subject = subjectById.get(g.subjectId);
          return `
          <tr data-id="${esc(g.id)}">
            <td>${esc(g.label)}${g.note ? `<br><small>${esc(g.note)}</small>` : ""}</td>
            <td>${esc(subject ? subject.name : g.subjectId || "")}</td>
            <td>${esc(g.periods)}</td>
            <td><input data-field="teachersNeeded" type="number" min="1" value="${esc(g.teachersNeeded)}" style="width:4em" /></td>
            <td><input data-field="note" value="${esc(g.note || "")}" /></td>
          </tr>
        `;
        })
        .join("");
      return `
        <div class="groups-level">
          <h3>Level ${esc(level)}</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Group</th><th>Subject</th><th>Periods</th><th>Teachers needed</th><th>Note</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderCustomGroups() {
  const data = getData();
  const tbody = document.querySelector("#table-custom-groups tbody");
  if (!tbody) return;
  const subjects = data.subjects || [];
  const customGroups = data.customGroups || [];

  if (customGroups.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8">No custom groups yet - add one for a one-off co-curricular group or similar.</td></tr>';
    return;
  }

  tbody.innerHTML = customGroups
    .map(
      (g) => `
    <tr data-id="${esc(g.id)}">
      <td><input data-field="level" type="number" min="1" value="${esc(g.level)}" style="width:4em" /></td>
      <td><input data-field="block" value="${esc(g.block)}" style="width:6em" /></td>
      <td><input data-field="label" value="${esc(g.label)}" /></td>
      <td><input data-field="periods" type="number" min="1" value="${esc(g.periods)}" style="width:4em" /></td>
      <td><input data-field="teachersNeeded" type="number" min="1" value="${esc(g.teachersNeeded)}" style="width:4em" /></td>
      <td>
        <select data-field="subjectId">
          <option value="">(none)</option>
          ${subjects.map((s) => `<option value="${esc(s.id)}" ${s.id === g.subjectId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
        </select>
      </td>
      <td><input data-field="note" value="${esc(g.note || "")}" /></td>
      <td><button data-action="delete-custom-group" title="Remove custom group">×</button></td>
    </tr>
  `,
    )
    .join("");
}

function wireGroups() {
  wireGeneratedGroups();
  wireCustomGroups();
  wireRegenerateButton();
}

function wireGeneratedGroups() {
  const container = document.getElementById("generated-groups");
  container.addEventListener("input", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const field = e.target.dataset.field;
    if (!field) return;
    if (isBlankNumberInput(e.target)) return;
    const groupId = row.dataset.id;
    const data = getData();
    const existing = (data.groupOverrides || {})[groupId] || {};
    const value =
      field === "teachersNeeded" ? Number(e.target.value) || 1 : e.target.value;
    const groupOverrides = {
      ...data.groupOverrides,
      [groupId]: { ...existing, [field]: value },
    };
    const droppedCount = setDataAndRegenerate({ ...data, groupOverrides });
    setGroupsStatus(
      droppedCount > 0
        ? `${esc(droppedCount)} assignment(s) were removed because their group no longer exists.`
        : "",
      "info",
    );
  });
}

function wireCustomGroups() {
  document
    .getElementById("btn-add-custom-group")
    .addEventListener("click", () => {
      const data = getData();
      const newGroup = {
        id: genId("g"),
        level: 1,
        block: "",
        label: "",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        category: "",
        note: "",
        subjectId: null,
        discipline: "",
        stream: "",
        classIds: [],
        bandId: null,
      };
      setDataAndRegenerate({
        ...data,
        customGroups: [...(data.customGroups || []), newGroup],
      });
    });

  const tbody = document.querySelector("#table-custom-groups tbody");

  tbody.addEventListener("input", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const id = row.dataset.id;
    const field = e.target.dataset.field;
    if (!field) return;
    if (isBlankNumberInput(e.target)) return;
    const data = getData();
    const customGroups = data.customGroups.map((g) => {
      if (g.id !== id) return g;
      if (
        field === "level" ||
        field === "periods" ||
        field === "teachersNeeded"
      ) {
        return { ...g, [field]: Number(e.target.value) || 0 };
      }
      return { ...g, [field]: e.target.value };
    });
    setDataAndRegenerate({ ...data, customGroups });
  });

  tbody.addEventListener("change", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.dataset.field !== "subjectId") return;
    const data = getData();
    const customGroups = data.customGroups.map((g) =>
      g.id === id ? { ...g, subjectId: e.target.value || null } : g,
    );
    setDataAndRegenerate({ ...data, customGroups });
  });

  tbody.addEventListener("click", (e) => {
    if (e.target.dataset.action !== "delete-custom-group") return;
    const id = e.target.closest("tr").dataset.id;
    const data = getData();
    const droppedCount = setDataAndRegenerate({
      ...data,
      customGroups: data.customGroups.filter((g) => g.id !== id),
    });
    setGroupsStatus(
      droppedCount > 0
        ? `${esc(droppedCount)} assignment(s) were removed because their group no longer exists.`
        : "",
      "info",
    );
  });
}

function wireRegenerateButton() {
  document
    .getElementById("btn-regenerate-groups")
    .addEventListener("click", () => {
      const droppedCount = setDataAndRegenerate(getData());
      setGroupsStatus(
        droppedCount > 0
          ? `Groups regenerated. ${esc(droppedCount)} assignment(s) were removed because their group no longer exists.`
          : "Groups regenerated.",
        droppedCount > 0 ? "info" : "ok",
      );
    });
}

export { renderGroups, wireGroups };
