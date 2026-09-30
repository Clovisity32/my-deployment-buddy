// Bands tab: per level, the bands pooling classes for a subject into N
// teaching groups. Also surfaces setupWarnings() inline so the HOD sees
// class/band/role problems without needing to solve first.

import { getData, setData } from "./store.js";
import { esc, genId, isBlankNumberInput } from "./dom.js";
import { rebuildGroups, setupWarnings } from "../setup.js";

// See subjects.js for why edits here immediately fold in rebuildGroups(). As
// with groups.js, surface droppedCount in this tab's own status box so a
// band/classIds edit that drops a (possibly locked) assignment isn't silent.
function setBandsStatus(html, kind) {
  const box = document.getElementById("bands-status");
  if (!box) return;
  box.innerHTML = html ? `<div class="status ${kind}">${html}</div>` : "";
}

function setDataAndRegenerate(next) {
  const { data: rebuilt, droppedCount } = rebuildGroups(next);
  setData(rebuilt);
  setBandsStatus(
    droppedCount > 0
      ? `${esc(droppedCount)} assignment(s) were removed because their group no longer exists.`
      : "",
    "info",
  );
}

/** A band's level = the level of its first member class (inconsistent bands are flagged by setupWarnings). */
function bandLevel(band, classById) {
  const classIds = Array.isArray(band.classIds) ? band.classIds : [];
  for (const id of classIds) {
    const cls = classById.get(id);
    if (cls && typeof cls.level === "number") return cls.level;
  }
  return null;
}

function renderBands() {
  const data = getData();
  const container = document.getElementById("bands-container");
  if (!container) return;
  const classes = data.classes || [];
  const subjects = data.subjects || [];
  const bands = data.bands || [];
  const classById = new Map(classes.map((c) => [c.id, c]));

  const levels = [...new Set(classes.map((c) => c.level))].sort(
    (a, b) => a - b,
  );

  if (levels.length === 0) {
    container.innerHTML =
      "<p>No classes yet - generate classes in the Classes tab first.</p>";
  } else {
    // A brand-new band starts with empty classIds, so it has no resolvable
    // level yet (Band has no `level` field - it's always derived from
    // member classes). Show those separately rather than let them vanish
    // until the HOD ticks a class.
    const unassigned = bands.filter((b) => bandLevel(b, classById) === null);
    container.innerHTML =
      (unassigned.length > 0
        ? renderUnassignedBands(unassigned, classes, subjects)
        : "") +
      levels
        .map((level) =>
          renderLevelBands(level, bands, classes, subjects, classById),
        )
        .join("");
  }

  renderBandWarnings();
}

function renderUnassignedBands(unassignedBands, classes, subjects) {
  return `
    <div class="bands-level bands-unassigned">
      <h3>New / unassigned bands</h3>
      <p><small>Tick at least one class below to assign this band to a level.</small></p>
      ${unassignedBands.map((band) => renderBandCard(band, classes, subjects)).join("")}
    </div>
  `;
}

function renderLevelBands(level, bands, classes, subjects, classById) {
  const classesAtLevel = classes.filter((c) => c.level === level);
  const subjectsAtLevel = subjects.filter(
    (s) => Array.isArray(s.levels) && s.levels.includes(level),
  );
  const bandsAtLevel = bands.filter((b) => bandLevel(b, classById) === level);

  return `
    <div class="bands-level">
      <div class="toolbar">
        <h3 style="flex:1;margin:0">Level ${esc(level)}</h3>
        <button data-action="add-band" data-level="${esc(level)}">+ Add band</button>
      </div>
      ${
        bandsAtLevel.length > 0
          ? bandsAtLevel
              .map((band) =>
                renderBandCard(band, classesAtLevel, subjectsAtLevel),
              )
              .join("")
          : "<p><small>No bands at this level yet.</small></p>"
      }
    </div>
  `;
}

function renderBandCard(band, classesAtLevel, subjectsAtLevel) {
  const classIds = Array.isArray(band.classIds) ? band.classIds : [];
  const bandSubjects = Array.isArray(band.subjects) ? band.subjects : [];

  return `
    <div class="band-card" data-id="${esc(band.id)}">
      <div class="toolbar">
        <input data-field="name" value="${esc(band.name)}" style="flex:1" />
        <button data-action="delete-band">Delete band</button>
      </div>
      <div class="band-classes">
        ${classesAtLevel
          .map(
            (c) => `
          <label>
            <input type="checkbox" data-action="toggle-class" data-class-id="${esc(c.id)}" ${classIds.includes(c.id) ? "checked" : ""} />
            ${esc(`${c.level} ${c.name} (${c.id})`)}
          </label>
        `,
          )
          .join("")}
      </div>
      <table class="band-subjects">
        <thead><tr><th>Subject</th><th>Groups</th><th></th></tr></thead>
        <tbody>
          ${bandSubjects
            .map(
              (entry, idx) => `
            <tr data-index="${esc(idx)}">
              <td>
                <select data-field="subjectId" data-index="${esc(idx)}">
                  ${subjectsAtLevel
                    .map(
                      (s) =>
                        `<option value="${esc(s.id)}" ${s.id === entry.subjectId ? "selected" : ""}>${esc(s.name)}</option>`,
                    )
                    .join("")}
                </select>
              </td>
              <td><input data-field="groups" data-index="${esc(idx)}" type="number" min="1" value="${esc(entry.groups)}" style="width:4em" /></td>
              <td><button data-action="remove-band-subject" data-index="${esc(idx)}">×</button></td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
      <button data-action="add-band-subject">+ Add subject to band</button>
    </div>
  `;
}

function renderBandWarnings() {
  const box = document.getElementById("bands-warnings");
  if (!box) return;
  const warnings = setupWarnings(getData());
  box.innerHTML =
    warnings.length > 0
      ? `<div class="status error">Setup warnings:<ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>`
      : "";
}

function wireBands() {
  const container = document.getElementById("bands-container");

  container.addEventListener("click", (e) => {
    const action = e.target.dataset.action;
    if (!action) return;
    const data = getData();

    if (action === "add-band") {
      // A new band always starts with no member classes ticked - the HOD
      // picks them via the checkboxes below, scoped to this level's card.
      setDataAndRegenerate({
        ...data,
        bands: [
          ...(data.bands || []),
          {
            id: genId("band"),
            name: "New band",
            classIds: [],
            subjects: [],
            note: "",
          },
        ],
      });
      return;
    }

    const card = e.target.closest(".band-card");
    if (!card) return;
    const id = card.dataset.id;

    if (action === "delete-band") {
      setDataAndRegenerate({
        ...data,
        bands: data.bands.filter((b) => b.id !== id),
      });
    } else if (action === "add-band-subject") {
      const subjects = data.subjects || [];
      const bands = data.bands.map((b) => {
        if (b.id !== id) return b;
        const defaultSubjectId = subjects[0]?.id || "";
        return {
          ...b,
          subjects: [
            ...(b.subjects || []),
            { subjectId: defaultSubjectId, groups: 1 },
          ],
        };
      });
      setDataAndRegenerate({ ...data, bands });
    } else if (action === "remove-band-subject") {
      const index = Number(e.target.dataset.index);
      const bands = data.bands.map((b) => {
        if (b.id !== id) return b;
        return { ...b, subjects: b.subjects.filter((_, i) => i !== index) };
      });
      setDataAndRegenerate({ ...data, bands });
    }
  });

  container.addEventListener("change", (e) => {
    const card = e.target.closest(".band-card");
    if (!card) return;
    const id = card.dataset.id;
    const data = getData();

    if (e.target.dataset.action === "toggle-class") {
      const classId = e.target.dataset.classId;
      const checked = e.target.checked;
      const bands = data.bands.map((b) => {
        if (b.id !== id) return b;
        const set = new Set(Array.isArray(b.classIds) ? b.classIds : []);
        if (checked) set.add(classId);
        else set.delete(classId);
        return { ...b, classIds: [...set] };
      });
      setDataAndRegenerate({ ...data, bands });
    } else if (e.target.dataset.field === "subjectId") {
      const index = Number(e.target.dataset.index);
      const bands = data.bands.map((b) => {
        if (b.id !== id) return b;
        const subjects = b.subjects.map((entry, i) =>
          i === index ? { ...entry, subjectId: e.target.value } : entry,
        );
        return { ...b, subjects };
      });
      setDataAndRegenerate({ ...data, bands });
    }
  });

  container.addEventListener("input", (e) => {
    const card = e.target.closest(".band-card");
    if (!card) return;
    const id = card.dataset.id;
    const data = getData();

    if (e.target.dataset.field === "name") {
      const bands = data.bands.map((b) =>
        b.id === id ? { ...b, name: e.target.value } : b,
      );
      setDataAndRegenerate({ ...data, bands });
    } else if (e.target.dataset.field === "groups") {
      if (isBlankNumberInput(e.target)) return;
      const index = Number(e.target.dataset.index);
      const bands = data.bands.map((b) => {
        if (b.id !== id) return b;
        const subjects = b.subjects.map((entry, i) =>
          i === index
            ? { ...entry, groups: Number(e.target.value) || 1 }
            : entry,
        );
        return { ...b, subjects };
      });
      setDataAndRegenerate({ ...data, bands });
    }
  });
}

export { renderBands, wireBands };
