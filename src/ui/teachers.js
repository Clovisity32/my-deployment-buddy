// Teachers tab: roles (fixed 4, caps editable), teachers (name, role, cap,
// placeholder), and a qualification tick grid (teacher x subject, grouped
// by discipline with a per-row "tick all in this discipline" mini-button).

import { getData, setData } from "./store.js";
import { esc, genId, isBlankNumberInput } from "./dom.js";

// Optional per-teacher group-count rules; blank = no rule (stored as null).
const COUNT_FIELDS = ["bigCount", "smallCount", "maxGroups"];

function renderTeachers() {
  renderRoles();
  renderTeacherTable();
  renderQualifications();
}

function renderRoles() {
  const data = getData();
  const tbody = document.querySelector("#table-roles tbody");
  if (!tbody) return;
  tbody.innerHTML = (data.roles || [])
    .map(
      (r) => `
    <tr data-id="${esc(r.id)}">
      <td><input data-field="name" value="${esc(r.name)}" /></td>
      <td>${
        r.maxPeriods === null
          ? '<span class="muted">(per-teacher)</span>'
          : `<input data-field="maxPeriods" type="number" min="0" value="${esc(r.maxPeriods)}" style="width:6em" />`
      }</td>
    </tr>
  `,
    )
    .join("");
}

function renderTeacherTable() {
  const data = getData();
  const roles = data.roles || [];
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const tbody = document.querySelector("#table-teachers tbody");
  if (!tbody) return;

  if ((data.teachers || []).length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8">No teachers yet - add one, or load the sample school.</td></tr>';
    return;
  }

  tbody.innerHTML = data.teachers
    .map((t) => {
      const role = roleById.get(t.roleId);
      const capCell =
        role && role.maxPeriods !== null
          ? `<span class="muted">${esc(role.maxPeriods)} (from role)</span>`
          : `<input data-field="capOverride" data-blank-ok type="number" min="0" value="${esc(t.capOverride ?? "")}" required />`;
      return `
      <tr data-id="${esc(t.id)}">
        <td><input data-field="name" value="${esc(t.name)}" /></td>
        <td>
          <select data-field="roleId">
            ${roles.map((r) => `<option value="${esc(r.id)}" ${r.id === t.roleId ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
          </select>
        </td>
        <td>${capCell}</td>
        ${COUNT_FIELDS.map((f) => `<td><input data-field="${f}" data-blank-ok type="number" min="0" step="1" placeholder="any" style="width:5em" value="${esc(t[f] ?? "")}" /></td>`).join("")}
        <td style="text-align:center"><input data-field="isPlaceholder" type="checkbox" ${t.isPlaceholder ? "checked" : ""} /></td>
        <td><button data-action="delete-teacher" title="Remove teacher">×</button></td>
      </tr>
    `;
    })
    .join("");
}

function renderQualifications() {
  const data = getData();
  const container = document.getElementById("qualifications-grid");
  if (!container) return;
  const teachers = data.teachers || [];
  const subjects = data.subjects || [];

  if (subjects.length === 0) {
    container.innerHTML =
      "<p>No subjects yet - add subjects in the Subjects tab first.</p>";
    return;
  }
  if (teachers.length === 0) {
    container.innerHTML = "<p>No teachers yet - add teachers above first.</p>";
    return;
  }

  const disciplines = [...new Set(subjects.map((s) => s.discipline))];
  const subjectsByDiscipline = disciplines.map((d) => ({
    discipline: d,
    subjects: subjects.filter((s) => s.discipline === d),
  }));

  const headerTop = subjectsByDiscipline
    .map(
      (g) =>
        `<th colspan="${esc(g.subjects.length + 1)}">${esc(g.discipline)}</th>`,
    )
    .join("");
  const headerSub = subjectsByDiscipline
    .map(
      (g) =>
        `${g.subjects.map((s) => `<th>${esc(s.name)}</th>`).join("")}<th>All</th>`,
    )
    .join("");

  const rows = teachers
    .map((t) => {
      const quals = new Set(t.qualifications || []);
      const cells = subjectsByDiscipline
        .map((g) => {
          const checks = g.subjects
            .map(
              (s) =>
                `<td style="text-align:center"><input type="checkbox" data-action="toggle-qual" data-teacher-id="${esc(t.id)}" data-subject-id="${esc(s.id)}" ${quals.has(s.id) ? "checked" : ""} /></td>`,
            )
            .join("");
          return `${checks}<td style="text-align:center"><button data-action="toggle-discipline" data-teacher-id="${esc(t.id)}" data-discipline="${esc(g.discipline)}" title="Tick/clear all ${esc(g.discipline)} for ${esc(t.name)}">✓</button></td>`;
        })
        .join("");
      return `<tr><td>${esc(t.name)}</td>${cells}</tr>`;
    })
    .join("");

  container.innerHTML = `
    <div class="table-wrap">
      <table class="qual-grid">
        <thead>
          <tr><th></th>${headerTop}</tr>
          <tr><th>Teacher</th>${headerSub}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function wireTeachers() {
  wireRoles();
  wireTeacherTable();
  wireQualifications();
}

function wireRoles() {
  const tbody = document.querySelector("#table-roles tbody");
  tbody.addEventListener("input", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const id = row.dataset.id;
    const field = e.target.dataset.field;
    if (!field) return;
    if (isBlankNumberInput(e.target)) return;
    const data = getData();
    const roles = data.roles.map((r) => {
      if (r.id !== id) return r;
      if (field === "maxPeriods")
        return { ...r, maxPeriods: Number(e.target.value) || 0 };
      return { ...r, [field]: e.target.value };
    });
    setData({ ...data, roles });
  });
}

function wireTeacherTable() {
  document.getElementById("btn-add-teacher").addEventListener("click", () => {
    const data = getData();
    const firstRole = (data.roles || [])[0];
    setData({
      ...data,
      teachers: [
        ...data.teachers,
        {
          id: genId("t"),
          name: "",
          roleId: firstRole ? firstRole.id : "",
          capOverride: null,
          bigCount: null,
          smallCount: null,
          maxGroups: null,
          qualifications: [],
          isPlaceholder: false,
        },
      ],
    });
  });

  const tbody = document.querySelector("#table-teachers tbody");

  tbody.addEventListener("input", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const id = row.dataset.id;
    const field = e.target.dataset.field;
    if (!field) return;
    // roleId (select) and isPlaceholder (checkbox) are handled exclusively
    // by the "change" listener below - a <select>/checkbox also fires
    // "input" before "change", and that generic branch would otherwise
    // update roleId without the capOverride reset the "change" handler
    // does, and the resulting re-render can detach the row before "change"
    // gets a chance to fire at all.
    if (field === "roleId" || field === "isPlaceholder") return;
    const data = getData();
    const teachers = data.teachers.map((t) => {
      if (t.id !== id) return t;
      if (field === "capOverride" || COUNT_FIELDS.includes(field))
        return {
          ...t,
          [field]:
            e.target.value === ""
              ? null
              : Math.max(0, Math.floor(Number(e.target.value) || 0)),
        };
      return { ...t, [field]: e.target.value };
    });
    setData({ ...data, teachers });
  });

  tbody.addEventListener("change", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    const id = row.dataset.id;
    const field = e.target.dataset.field;
    if (!field) return;
    const data = getData();
    if (field === "roleId") {
      // Always clear capOverride on role change - it otherwise silently
      // keeps capping the teacher at their old role's stand-in value even
      // once effectiveCap() should fall through to the new role's
      // maxPeriods. If the HOD switches to "Others" they'll immediately see
      // the (now-null) editable cap input, and setupWarnings() already
      // flags an Others-role teacher with no cap set - self-correcting via
      // existing UI, not a new problem.
      const teachers = data.teachers.map((t) =>
        t.id === id ? { ...t, roleId: e.target.value, capOverride: null } : t,
      );
      setData({ ...data, teachers });
    } else if (field === "isPlaceholder") {
      const teachers = data.teachers.map((t) =>
        t.id === id ? { ...t, isPlaceholder: e.target.checked } : t,
      );
      setData({ ...data, teachers });
    }
  });

  tbody.addEventListener("click", (e) => {
    if (e.target.dataset.action !== "delete-teacher") return;
    const id = e.target.closest("tr").dataset.id;
    const data = getData();
    setData({
      ...data,
      teachers: data.teachers.filter((t) => t.id !== id),
      assignments: (data.assignments || []).filter((a) => a.teacherId !== id),
    });
  });
}

function wireQualifications() {
  const container = document.getElementById("qualifications-grid");

  container.addEventListener("change", (e) => {
    if (e.target.dataset.action !== "toggle-qual") return;
    const teacherId = e.target.dataset.teacherId;
    const subjectId = e.target.dataset.subjectId;
    const checked = e.target.checked;
    const data = getData();
    const teachers = data.teachers.map((t) => {
      if (t.id !== teacherId) return t;
      const set = new Set(t.qualifications || []);
      if (checked) set.add(subjectId);
      else set.delete(subjectId);
      return { ...t, qualifications: [...set] };
    });
    setData({ ...data, teachers });
  });

  container.addEventListener("click", (e) => {
    if (e.target.dataset.action !== "toggle-discipline") return;
    const teacherId = e.target.dataset.teacherId;
    const discipline = e.target.dataset.discipline;
    const data = getData();
    const subjectIdsInDiscipline = (data.subjects || [])
      .filter((s) => s.discipline === discipline)
      .map((s) => s.id);
    const teachers = data.teachers.map((t) => {
      if (t.id !== teacherId) return t;
      const quals = new Set(t.qualifications || []);
      const allTicked = subjectIdsInDiscipline.every((id) => quals.has(id));
      if (allTicked) {
        subjectIdsInDiscipline.forEach((id) => quals.delete(id));
      } else {
        subjectIdsInDiscipline.forEach((id) => quals.add(id));
      }
      return { ...t, qualifications: [...quals] };
    });
    setData({ ...data, teachers });
  });
}

export { renderTeachers, wireTeachers };
