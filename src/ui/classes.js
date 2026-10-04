// Classes tab: a "No. of classes per level" + class-name cycle toolbar
// feeding generateClasses(), plus one grid per level (classes x subjects
// offered at that level) for ticking which subjects each class takes.

import { getData, setData } from "./store.js";
import { esc } from "./dom.js";
import {
  defaultClassNames,
  generateClasses,
  applySetupEdit,
} from "../setup.js";

const LEVELS = [1, 2, 3, 4, 5];

// See subjects.js for why edits here immediately fold in rebuildGroups() and
// surface droppedCount in this tab's own status box.
function setClassesStatus(html, kind) {
  const box = document.getElementById("classes-status");
  if (!box) return;
  box.innerHTML = html ? `<div class="status ${kind}">${html}</div>` : "";
}

function setDataAndRegenerate(next) {
  const { data: rebuilt, droppedCount, frozen } = applySetupEdit(next);
  setData(rebuilt);
  setClassesStatus(
    frozen
      ? 'Your Board groups were left as they are. Press "Rebuild groups from setup" if you want them to follow this change.'
      : droppedCount > 0
        ? `${esc(droppedCount)} assignment(s) were removed because their group no longer exists.`
        : "",
    "info",
  );
}

// The toolbar (count inputs + class-name textarea) is static markup in
// index.html, NOT re-rendered by renderClasses() - every table in this app
// re-renders its whole innerHTML on every data change (see wireTeachers'
// existing pattern), which would otherwise wipe out whatever the HOD is
// mid-typing into the toolbar on every unrelated edit elsewhere in the app.
// Only the per-level grids below are driven live off `data`.
function renderClasses() {
  const data = getData();
  const container = document.getElementById("classes-grids");
  if (!container) return;
  const subjects = data.subjects || [];
  const classes = data.classes || [];

  if (subjects.length === 0) {
    container.innerHTML =
      "<p>No subjects yet - add subjects in the Subjects tab first, then come back here to assign them to classes.</p>";
    return;
  }
  if (classes.length === 0) {
    container.innerHTML =
      '<p>No classes yet - use "Generate classes" above, or load the sample school.</p>';
    return;
  }

  const levels = [...new Set(classes.map((c) => c.level))].sort(
    (a, b) => a - b,
  );
  container.innerHTML = levels
    .map((level) => renderLevelGrid(level, classes, subjects))
    .join("");
}

function renderLevelGrid(level, classes, subjects) {
  const classesAtLevel = classes.filter((c) => c.level === level);
  const subjectsAtLevel = subjects.filter(
    (s) => Array.isArray(s.levels) && s.levels.includes(level),
  );

  if (subjectsAtLevel.length === 0) {
    return `
      <div class="classes-level">
        <h3>Level ${esc(level)}</h3>
        <p><small>No subjects are offered at this level yet.</small></p>
      </div>
    `;
  }

  const header = `<tr><th>Class</th>${subjectsAtLevel.map((s) => `<th>${esc(s.name)}</th>`).join("")}</tr>`;
  const rows = classesAtLevel
    .map((cls) => {
      const subjectIds = Array.isArray(cls.subjectIds) ? cls.subjectIds : [];
      const cells = subjectsAtLevel
        .map(
          (s) => `
        <td style="text-align:center">
          <input type="checkbox" data-action="toggle-subject" data-class-id="${esc(cls.id)}" data-subject-id="${esc(s.id)}" ${subjectIds.includes(s.id) ? "checked" : ""} />
        </td>
      `,
        )
        .join("");
      return `
      <tr data-id="${esc(cls.id)}">
        <td>
          <input data-field="name" value="${esc(cls.name)}" style="width:8em" />
          <div><small>${esc(`${cls.level} ${cls.name} (${cls.id})`)}</small></div>
        </td>
        ${cells}
      </tr>
    `;
    })
    .join("");

  return `
    <div class="classes-level">
      <h3>Level ${esc(level)}</h3>
      <div class="table-wrap">
        <table>
          <thead>${header}</thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function wireClasses() {
  // One-time init of the toolbar from whatever's currently in storage, so
  // the count inputs aren't misleadingly blank (which would delete existing
  // classes at every level on the first "Generate classes" click).
  const data = getData();
  const countsByLevel = {};
  (data.classes || []).forEach((c) => {
    countsByLevel[c.level] = (countsByLevel[c.level] || 0) + 1;
  });
  LEVELS.forEach((lvl) => {
    const input = document.getElementById(`class-count-${lvl}`);
    if (input && countsByLevel[lvl]) input.value = countsByLevel[lvl];
  });
  const namesInput = document.getElementById("class-names");
  if (namesInput && !namesInput.value.trim()) {
    namesInput.value = defaultClassNames().join("\n");
  }

  document
    .getElementById("btn-generate-classes")
    .addEventListener("click", () => {
      const counts = {};
      LEVELS.forEach((lvl) => {
        const el = document.getElementById(`class-count-${lvl}`);
        const v = el ? Number(el.value) || 0 : 0;
        if (v > 0) counts[lvl] = v;
      });
      const namesEl = document.getElementById("class-names");
      const names = (namesEl ? namesEl.value : "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const current = getData();
      const nextClasses = generateClasses(
        counts,
        names.length > 0 ? names : defaultClassNames(),
        current.classes,
      );
      setDataAndRegenerate({ ...current, classes: nextClasses });
    });

  const container = document.getElementById("classes-grids");
  container.addEventListener("input", (e) => {
    if (e.target.dataset.field !== "name") return;
    const row = e.target.closest("tr");
    if (!row) return;
    const classId = row.dataset.id;
    const data2 = getData();
    const classes = data2.classes.map((c) =>
      c.id === classId ? { ...c, name: e.target.value } : c,
    );
    setDataAndRegenerate({ ...data2, classes });
  });

  container.addEventListener("change", (e) => {
    if (e.target.dataset.action !== "toggle-subject") return;
    const classId = e.target.dataset.classId;
    const subjectId = e.target.dataset.subjectId;
    const checked = e.target.checked;
    const data2 = getData();
    const classes = data2.classes.map((c) => {
      if (c.id !== classId) return c;
      const subjectIds = new Set(
        Array.isArray(c.subjectIds) ? c.subjectIds : [],
      );
      if (checked) subjectIds.add(subjectId);
      else subjectIds.delete(subjectId);
      return { ...c, subjectIds: [...subjectIds] };
    });
    setDataAndRegenerate({ ...data2, classes });
  });
}

export { renderClasses, wireClasses };
