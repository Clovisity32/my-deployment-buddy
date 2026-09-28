// Browser UI wiring: plain HTML tables + vanilla JS, no framework/grid
// library to vendor (see the approved plan). Every function that builds
// HTML from data routes every interpolated value - text AND attribute
// values - through esc(), per the project's attribute-injection lesson.

import { emptyData, validate, loadFromStorage, saveToStorage } from "./data.js";
import { buildModel } from "./model.js";
import { solveModel } from "./solve.js";
import { diagnoseInfeasibility } from "./diagnose.js";
import { buildDeploymentView } from "./view.js";
import {
  saveVersion,
  listVersions,
  restoreVersion,
  compareAssignments,
} from "./versions.js";
import { exportWorkbook, importWorkbook } from "./excel.js";
import { getLayers } from "./layers/registry.js";

/** Escapes a value for safe interpolation into HTML text OR an attribute. */
function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch],
  );
}

function genId(prefix) {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let data = loadFromStorage();
let dirty = false; // true once data has changed since the last "Save to Excel".

function setData(next) {
  data = next;
  dirty = true;
  saveToStorage(data); // Best-effort - the Excel file remains the real source of truth.
  renderAll();
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function initTabs() {
  const tabButtons = document.querySelectorAll("nav.tabs button");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll("main .panel")
        .forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document
        .getElementById(`panel-${btn.dataset.tab}`)
        .classList.add("active");
    });
  });
}

// ---------------------------------------------------------------------------
// Teachers tab
// ---------------------------------------------------------------------------

function renderTeachers() {
  const tbody = document.querySelector("#table-teachers tbody");
  tbody.innerHTML = data.teachers
    .map(
      (t) => `
    <tr data-id="${esc(t.id)}">
      <td><input data-field="name" value="${esc(t.name)}" /></td>
      <td><input data-field="maxPeriods" type="number" min="0" value="${esc(t.maxPeriods)}" /></td>
      <td><input data-field="subjects" value="${esc((t.subjects || []).join(", "))}" placeholder="e.g. Chem, Phy" /></td>
      <td style="text-align:center"><input data-field="isPlaceholder" type="checkbox" ${t.isPlaceholder ? "checked" : ""} /></td>
      <td><button data-action="delete-teacher" title="Remove teacher">×</button></td>
    </tr>
  `,
    )
    .join("");
}

function wireTeachers() {
  document.getElementById("btn-add-teacher").addEventListener("click", () => {
    const next = {
      ...data,
      teachers: [
        ...data.teachers,
        { id: genId("t"), name: "", maxPeriods: 20, subjects: [] },
      ],
    };
    setData(next);
  });

  const tbody = document.querySelector("#table-teachers tbody");
  tbody.addEventListener("input", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const id = row.dataset.id;
    const field = e.target.dataset.field;
    if (!field) return;
    const teachers = data.teachers.map((t) => {
      if (t.id !== id) return t;
      if (field === "maxPeriods")
        return { ...t, maxPeriods: Number(e.target.value) || 0 };
      if (field === "subjects")
        return {
          ...t,
          subjects: e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
      if (field === "isPlaceholder")
        return { ...t, isPlaceholder: e.target.checked };
      return { ...t, [field]: e.target.value };
    });
    setData({ ...data, teachers });
  });

  tbody.addEventListener("click", (e) => {
    if (e.target.dataset.action !== "delete-teacher") return;
    const id = e.target.closest("tr").dataset.id;
    setData({
      ...data,
      teachers: data.teachers.filter((t) => t.id !== id),
      assignments: (data.assignments || []).filter((a) => a.teacherId !== id),
    });
  });
}

// ---------------------------------------------------------------------------
// Groups tab
// ---------------------------------------------------------------------------

function renderGroups() {
  const tbody = document.querySelector("#table-groups tbody");
  tbody.innerHTML = data.groups
    .map(
      (g) => `
    <tr data-id="${esc(g.id)}">
      <td><input data-field="level" type="number" min="1" value="${esc(g.level)}" style="width:4em" /></td>
      <td><input data-field="block" value="${esc(g.block)}" style="width:6em" /></td>
      <td><input data-field="label" value="${esc(g.label)}" /></td>
      <td><input data-field="periods" type="number" min="1" value="${esc(g.periods)}" style="width:4em" /></td>
      <td><input data-field="teachersNeeded" type="number" min="1" value="${esc(g.teachersNeeded)}" style="width:4em" /></td>
      <td><input data-field="band" value="${esc(g.band || "")}" placeholder="(none)" /></td>
      <td><input data-field="category" value="${esc(g.category || "")}" style="width:5em" /></td>
      <td><input data-field="note" value="${esc(g.note || "")}" /></td>
      <td><button data-action="delete-group" title="Remove group">×</button></td>
    </tr>
  `,
    )
    .join("");
}

function wireGroups() {
  document.getElementById("btn-add-group").addEventListener("click", () => {
    const next = {
      ...data,
      groups: [
        ...data.groups,
        {
          id: genId("g"),
          level: 1,
          block: "",
          label: "",
          periods: 4,
          band: null,
          teachersNeeded: 1,
          category: "",
          note: "",
        },
      ],
    };
    setData(next);
  });

  const tbody = document.querySelector("#table-groups tbody");
  tbody.addEventListener("input", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const id = row.dataset.id;
    const field = e.target.dataset.field;
    if (!field) return;
    const groups = data.groups.map((g) => {
      if (g.id !== id) return g;
      if (
        field === "level" ||
        field === "periods" ||
        field === "teachersNeeded"
      ) {
        return { ...g, [field]: Number(e.target.value) || 0 };
      }
      if (field === "band")
        return { ...g, band: e.target.value.trim() || null };
      return { ...g, [field]: e.target.value };
    });
    setData({ ...data, groups });
  });

  tbody.addEventListener("click", (e) => {
    if (e.target.dataset.action !== "delete-group") return;
    const id = e.target.closest("tr").dataset.id;
    setData({
      ...data,
      groups: data.groups.filter((g) => g.id !== id),
      assignments: (data.assignments || []).filter((a) => a.groupId !== id),
    });
  });
}

// ---------------------------------------------------------------------------
// Layers tab + Solve
// ---------------------------------------------------------------------------

function settingFor(layerId) {
  return (data.layerSettings || []).find((s) => s.id === layerId);
}

function renderLayers() {
  const list = document.getElementById("layers-list");
  list.innerHTML = getLayers()
    .map((layer) => {
      const setting = settingFor(layer.id);
      const enabled = setting ? setting.enabled !== false : true;
      const weight =
        setting && typeof setting.weight === "number"
          ? setting.weight
          : layer.defaultWeight;
      return `
      <div class="layer-card" data-layer-id="${esc(layer.id)}">
        <input type="checkbox" data-action="toggle-layer" ${enabled ? "checked" : ""} title="Enable/disable this layer" />
        <div class="body">
          <div class="title-row">
            <strong>${esc(layer.name)}</strong>
            <span class="badge ${layer.kind}">${esc(layer.kind)}</span>
          </div>
          <p>${esc(layer.describe(data))}</p>
          ${
            layer.kind === "soft"
              ? `
            <div class="weight-field">
              <label>Weight</label>
              <input type="number" min="0" step="1" data-action="weight-layer" value="${esc(weight)}" />
            </div>`
              : ""
          }
        </div>
      </div>
    `;
    })
    .join("");
}

function wireLayers() {
  const list = document.getElementById("layers-list");
  list.addEventListener("change", (e) => {
    const card = e.target.closest(".layer-card");
    if (!card) return;
    const layerId = card.dataset.layerId;
    const layers = getLayers();
    const layer = layers.find((l) => l.id === layerId);
    const existing = (data.layerSettings || []).filter((s) => s.id !== layerId);
    const current = settingFor(layerId) || {
      id: layerId,
      enabled: true,
      weight: layer.defaultWeight,
    };

    if (e.target.dataset.action === "toggle-layer") {
      setData({
        ...data,
        layerSettings: [...existing, { ...current, enabled: e.target.checked }],
      });
    } else if (e.target.dataset.action === "weight-layer") {
      setData({
        ...data,
        layerSettings: [
          ...existing,
          { ...current, weight: Number(e.target.value) || 0 },
        ],
      });
    }
  });

  document.getElementById("btn-solve").addEventListener("click", onSolve);
}

function setStatus(html, kind) {
  const box = document.getElementById("solve-status");
  box.innerHTML = html ? `<div class="status ${kind}">${html}</div>` : "";
}

async function onSolve() {
  const btn = document.getElementById("btn-solve");
  btn.disabled = true;
  setStatus("Solving…", "info");
  try {
    // Auto-snapshot before every solve, so a re-solve can always be undone
    // via the Versions tab - re-opening/re-solving must never lose a
    // deployment the HOD already had.
    let working = data;
    if ((working.assignments || []).length > 0) {
      working = saveVersion(working, "Auto-save before solve");
    }

    const model = buildModel(working);
    const result = await solveModel(model);

    if (result.optimal) {
      setData({
        ...working,
        assignments: result.assignments.map((a) => ({
          ...a,
          locked: wasLocked(working, a),
        })),
      });
      setStatus(
        `Solved. ${result.assignments.length} assignment(s) made.`,
        "ok",
      );
    } else {
      const diagnosis = await diagnoseInfeasibility(working, model);
      setData(working); // Keep the auto-snapshot even though the solve failed.
      setStatus(
        `Could not find a deployment that satisfies every hard constraint:<ul>${diagnosis.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`,
        "error",
      );
    }
  } catch (err) {
    setStatus(
      `Something went wrong while solving: ${esc(err.message)}`,
      "error",
    );
  } finally {
    btn.disabled = false;
  }
}

function wasLocked(beforeData, assignment) {
  const prior = (beforeData.assignments || []).find(
    (a) =>
      a.teacherId === assignment.teacherId && a.groupId === assignment.groupId,
  );
  return Boolean(prior && prior.locked);
}

// ---------------------------------------------------------------------------
// Deployment View tab
// ---------------------------------------------------------------------------

function qualifiedTeachers(block) {
  return data.teachers.filter(
    (t) => Array.isArray(t.subjects) && t.subjects.includes(block),
  );
}

function renderDeployment() {
  const container = document.getElementById("deployment-view");
  const view = buildDeploymentView(data);

  if (view.length === 0) {
    container.innerHTML =
      "<p>No groups yet - add some in the Groups tab, or load the sample school.</p>";
  } else {
    container.innerHTML = view
      .map(
        (levelEntry) => `
      <div class="deployment-level">
        <h2>Level ${esc(levelEntry.level)}</h2>
        <div class="deployment-blocks">
          ${levelEntry.blocks.map((blockEntry) => renderDeploymentBlock(blockEntry)).join("")}
        </div>
      </div>
    `,
      )
      .join("");
  }

  renderLoadPanel();
}

function renderDeploymentBlock(blockEntry) {
  const rows = blockEntry.rows
    .map((row) => {
      const rowClasses = [
        !row.complete ? "row-incomplete" : "",
        row.hasPlaceholder ? "row-placeholder" : "",
        row.anyLocked ? "row-locked" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const seats = Array.from({ length: row.teachersNeeded }, (_, seatIndex) =>
        renderSeat(row, blockEntry.block, seatIndex),
      );

      return `
      <tr class="${rowClasses}" data-group-id="${esc(row.groupId)}">
        <td>${esc(row.label)}${row.note ? `<br><small>${esc(row.note)}</small>` : ""}</td>
        <td>${seats.join("")}</td>
      </tr>
    `;
    })
    .join("");

  return `
    <div class="deployment-block">
      <h3>${esc(blockEntry.block)}</h3>
      <table>
        <thead><tr><th>Group</th><th>Teacher(s)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderSeat(row, block, seatIndex) {
  const currentTeacherId = seatTeacherId(row.groupId, seatIndex);
  const options = [
    '<option value="">(none)</option>',
    ...qualifiedTeachers(block).map(
      (t) =>
        `<option value="${esc(t.id)}" ${t.id === currentTeacherId ? "selected" : ""}>${esc(t.name)}${t.isPlaceholder ? " (placeholder)" : ""}</option>`,
    ),
  ].join("");
  const isLocked = Boolean(
    (data.assignments || []).find(
      (a) => a.groupId === row.groupId && a.teacherId === currentTeacherId,
    )?.locked,
  );

  return `
    <div class="seat" data-seat-index="${seatIndex}">
      <select data-action="reassign" data-group-id="${esc(row.groupId)}" data-seat-index="${seatIndex}">${options}</select>
      <label class="lock-toggle" title="Lock this assignment so Solve never changes it">
        <input type="checkbox" data-action="toggle-lock" data-group-id="${esc(row.groupId)}" data-seat-index="${seatIndex}" ${currentTeacherId ? "" : "disabled"} ${isLocked ? "checked" : ""} />
        🔒
      </label>
    </div>
  `;
}

/** The teacherId currently occupying seatIndex of groupId (assignment order = seat order). */
function seatTeacherId(groupId, seatIndex) {
  const assignmentsForGroup = (data.assignments || []).filter(
    (a) => a.groupId === groupId,
  );
  return assignmentsForGroup[seatIndex]?.teacherId || "";
}

function renderLoadPanel() {
  const panel = document.getElementById("load-panel");
  const loadByTeacher = new Map();
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  for (const a of data.assignments || []) {
    const g = groupById.get(a.groupId);
    if (!g) continue;
    loadByTeacher.set(
      a.teacherId,
      (loadByTeacher.get(a.teacherId) || 0) + g.periods,
    );
  }

  panel.innerHTML = data.teachers
    .map((t) => {
      const load = loadByTeacher.get(t.id) || 0;
      const pct =
        t.maxPeriods > 0 ? Math.min(100, (load / t.maxPeriods) * 100) : 0;
      const over = load > t.maxPeriods;
      return `
      <div style="margin-bottom:6px">
        <div style="display:flex;justify-content:space-between"><span>${esc(t.name)}</span><span>${esc(load)} / ${esc(t.maxPeriods)}${over ? " ⚠️ over cap" : ""}</span></div>
        <div class="load-bar-track"><div class="load-bar-fill ${over ? "over" : ""}" style="width:${pct}%"></div></div>
      </div>
    `;
    })
    .join("");
}

function wireDeployment() {
  const container = document.getElementById("deployment-view");

  container.addEventListener("change", (e) => {
    const groupId = e.target.dataset.groupId;
    if (!groupId) return;
    const seatIndex = Number(e.target.dataset.seatIndex);
    const group = data.groups.find((g) => g.id === groupId);
    let assignmentsForGroup = (data.assignments || []).filter(
      (a) => a.groupId === groupId,
    );
    const others = (data.assignments || []).filter(
      (a) => a.groupId !== groupId,
    );

    if (e.target.dataset.action === "reassign") {
      const newTeacherId = e.target.value;
      assignmentsForGroup[seatIndex] = newTeacherId
        ? { teacherId: newTeacherId, groupId, locked: false }
        : undefined;
      assignmentsForGroup = assignmentsForGroup.filter(Boolean);
    } else if (e.target.dataset.action === "toggle-lock") {
      if (assignmentsForGroup[seatIndex]) {
        assignmentsForGroup[seatIndex] = {
          ...assignmentsForGroup[seatIndex],
          locked: e.target.checked,
        };
      }
    } else {
      return;
    }

    setData({ ...data, assignments: [...others, ...assignmentsForGroup] });
  });
}

// ---------------------------------------------------------------------------
// Versions tab
// ---------------------------------------------------------------------------

function renderVersions() {
  const list = document.getElementById("versions-list");
  const versions = data.versions || [];
  if (versions.length === 0) {
    list.innerHTML = "<li>No saved versions yet.</li>";
    return;
  }
  // Render in original (save) order but show newest first, keeping the
  // original index so Restore/Compare can address versions.js by index.
  const withIndex = versions.map((v, i) => ({ ...v, index: i }));
  withIndex.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  list.innerHTML = withIndex
    .map((v) => {
      const changes = compareAssignments(v.assignments, data.assignments || []);
      return `
      <li>
        <strong>${esc(v.name)}</strong> - <small>${esc(new Date(v.timestamp).toLocaleString())}</small>
        (${changes.length === 0 ? "same as current" : `${changes.length} group(s) differ from current`})
        <button data-action="restore-version" data-index="${v.index}">Restore</button>
      </li>
    `;
    })
    .join("");
}

function wireVersions() {
  document.getElementById("btn-save-version").addEventListener("click", () => {
    const input = document.getElementById("version-name");
    const name =
      input.value.trim() || `Version ${(data.versions || []).length + 1}`;
    setData(saveVersion(data, name));
    input.value = "";
  });

  document.getElementById("versions-list").addEventListener("click", (e) => {
    if (e.target.dataset.action !== "restore-version") return;
    const index = Number(e.target.dataset.index);
    if (
      !confirm(
        "Restore this version? Your current (unsaved-as-a-version) changes will be replaced.",
      )
    )
      return;
    setData(restoreVersion(data, index));
  });
}

// ---------------------------------------------------------------------------
// File actions: sample / Excel import / Excel export
// ---------------------------------------------------------------------------

function wireFileActions() {
  document
    .getElementById("btn-load-sample")
    .addEventListener("click", async () => {
      try {
        const res = await fetch("sample/sample.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const sample = await res.json();
        const errors = validate(sample);
        if (errors.length > 0) throw new Error(errors.join("; "));
        setData(sample);
      } catch (err) {
        alert(
          `Could not load the sample school: ${err.message}\n\nIf you opened this file directly (file://), try running it through a local web server instead.`,
        );
      }
    });

  document.getElementById("btn-export").addEventListener("click", () => {
    exportWorkbook(data, "deployment.xlsx");
    dirty = false;
  });

  document.getElementById("btn-import").addEventListener("click", () => {
    document.getElementById("file-input").click();
  });

  document
    .getElementById("file-input")
    .addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = ""; // Allow re-selecting the same file later.
      if (!file) return;
      try {
        const imported = await importWorkbook(file);
        const errors = validate(imported);
        if (errors.length > 0) {
          alert(
            `This Excel file doesn't look like a valid deployment file:\n\n${errors.join("\n")}`,
          );
          return;
        }
        dirty = false;
        setData(imported);
      } catch (err) {
        alert(`Could not read that Excel file: ${err.message}`);
      }
    });

  window.addEventListener("beforeunload", (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function renderAll() {
  renderTeachers();
  renderGroups();
  renderLayers();
  renderDeployment();
  renderVersions();
}

function init() {
  if (!data || (data.teachers.length === 0 && data.groups.length === 0)) {
    data = emptyData();
  }
  initTabs();
  wireTeachers();
  wireGroups();
  wireLayers();
  wireDeployment();
  wireVersions();
  wireFileActions();
  renderAll();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

export { esc, genId };
