// Browser UI boot: gates the app behind Google Sign-In (src/auth.js), then
// wires together the store (src/ui/store.js) and each tab module under
// src/ui/. Keeps only what doesn't belong to a single tab module - the
// Solve/Layers panel, the Versions tab, file actions (sample load / Excel
// import-export), and boot/tabs.

import { validate } from "./data.js";
import { buildModel } from "./model.js";
import { solveModel } from "./solve.js";
import { diagnoseInfeasibility } from "./diagnose.js";
import {
  saveVersion,
  listVersions,
  restoreVersion,
  compareAssignments,
} from "./versions.js";
import { exportWorkbook, importWorkbook } from "./excel.js";
import { getLayers } from "./layers/registry.js";

import { esc, genId, withFocusPreserved } from "./ui/dom.js";
import {
  initStore,
  getData,
  setData,
  onChange,
  onSaveStatusChange,
  getFirestoreDb,
} from "./ui/store.js";
import { onAuthChange, signInWithGoogle, signOutUser } from "./auth.js";

import { renderSubjects, wireSubjects } from "./ui/subjects.js";
import { renderClasses, wireClasses } from "./ui/classes.js";
import { renderBands, wireBands } from "./ui/bands.js";
import { renderTeachers, wireTeachers } from "./ui/teachers.js";
import { renderGroups, wireGroups } from "./ui/groups.js";
import { renderDeployment, wireDeployment } from "./ui/deployment.js";

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
// Solve / Layers tab
// ---------------------------------------------------------------------------

function settingFor(layerId) {
  return (getData().layerSettings || []).find((s) => s.id === layerId);
}

function renderLayers() {
  const data = getData();
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
    const data = getData();
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
    // deployment the HOD already had. Versions now save directly to their
    // own Firestore subcollection (Task 5), independent of setData() below
    // - the snapshot is durable as soon as saveVersion() resolves, whether
    // or not the solve itself succeeds.
    const working = getData();
    if ((working.assignments || []).length > 0) {
      await saveVersion(
        getFirestoreDb(),
        "Auto-save before solve",
        working.assignments,
        working.layerSettings,
      );
    }

    const model = buildModel(working);
    const result = await solveModel(model);

    if (result.optimal) {
      // Await the write: reload-never-re-solves also means a reload right
      // after "Solved" must see these exact assignments, not whatever was
      // last durable in Firestore - without this await, setData()'s write
      // is still in flight (fire-and-forget) when "Solved" appears, and an
      // immediate reload can race it and lose the solve.
      await setData({
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
// Versions tab
// ---------------------------------------------------------------------------

function renderVersions() {
  const list = document.getElementById("versions-list");
  list.innerHTML = "<li>Loading versions…</li>";
  const data = getData();
  listVersions(getFirestoreDb(), data.assignments || []).then((versions) => {
    if (versions.length === 0) {
      list.innerHTML = "<li>No saved versions yet.</li>";
      return;
    }
    list.innerHTML = versions
      .map(
        (v) => `
      <li>
        <strong>${esc(v.name)}</strong> - <small>${esc(new Date(v.timestamp).toLocaleString())}</small>
        (${v.changedCount === 0 ? "same as current" : `${v.changedCount} group(s) differ from current`})
        <button data-action="restore-version" data-id="${esc(v.id)}">Restore</button>
      </li>
    `,
      )
      .join("");
  });
}

function wireVersions() {
  document
    .getElementById("btn-save-version")
    .addEventListener("click", async () => {
      const input = document.getElementById("version-name");
      const data = getData();
      const name = input.value.trim() || "Version";
      await saveVersion(
        getFirestoreDb(),
        name,
        data.assignments,
        data.layerSettings,
      );
      input.value = "";
      renderVersions();
    });

  document
    .getElementById("versions-list")
    .addEventListener("click", async (e) => {
      if (e.target.dataset.action !== "restore-version") return;
      const versionId = e.target.dataset.id;
      if (
        !confirm(
          "Restore this version? Your current (unsaved-as-a-version) changes will be replaced.",
        )
      )
        return;
      const restored = await restoreVersion(
        getFirestoreDb(),
        getData(),
        versionId,
      );
      setData(restored);
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
    exportWorkbook(getData(), "deployment.xlsx");
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
        setData(imported);
      } catch (err) {
        alert(`Could not read that Excel file: ${err.message}`);
      }
    });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function renderAll() {
  renderSubjects();
  renderClasses();
  renderBands();
  renderTeachers();
  renderGroups();
  renderLayers();
  renderDeployment();
  renderVersions();
}

function renderSaveStatus({ status, message }) {
  const box = document.getElementById("save-status");
  if (!box) return;
  const labels = {
    idle: "",
    saving: "Saving…",
    saved: "Saved",
    conflict: `⚠ ${message}`,
    error: `⚠ ${message}`,
    blocked: message || "Reload the page to continue.",
  };
  box.textContent = labels[status] || "";
  box.classList.toggle(
    "error",
    status === "conflict" || status === "error" || status === "blocked",
  );
}

let wired = false;

async function onSignedIn(user) {
  document.getElementById("sign-in-screen").hidden = true;
  const shell = document.getElementById("app-shell");
  shell.hidden = false;
  document.getElementById("current-user-email").textContent = user.email;

  try {
    await initStore();
  } catch (err) {
    // A native alert() would never be visible to a test asserting on page
    // content (Task 9's "unauthorized email" test checks page body text) -
    // and a signed-in-but-denied user (wrong email, or Firestore briefly
    // unreachable) deserves a persistent, readable message anyway, not a
    // dismissable popup. #save-status already exists (Task 6) and is inside
    // the now-visible #app-shell.
    const status = document.getElementById("save-status");
    status.textContent = `Could not load the deployment from the cloud: ${err.message}. Check your internet connection and that your account has access.`;
    status.classList.add("error");
    return;
  }

  if (!wired) {
    wired = true;
    onSaveStatusChange(renderSaveStatus);
    initTabs();
    wireSubjects();
    wireClasses();
    wireBands();
    wireTeachers();
    wireGroups();
    wireLayers();
    wireDeployment();
    wireVersions();
    wireFileActions();
    onChange(() =>
      withFocusPreserved(document.getElementById("app-shell"), renderAll),
    );
  }
  renderAll();
}

function onSignedOut() {
  document.getElementById("sign-in-screen").hidden = false;
  document.getElementById("app-shell").hidden = true;
}

function boot() {
  document.getElementById("sign-in-button").addEventListener("click", () => {
    signInWithGoogle().catch((err) => alert(`Sign-in failed: ${err.message}`));
  });
  document
    .getElementById("sign-out-button")
    .addEventListener("click", () => signOutUser());

  onAuthChange((user) => {
    if (user) onSignedIn(user);
    else onSignedOut();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}

export { esc, genId } from "./ui/dom.js";
