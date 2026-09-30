// Deployment View tab: summary strip, a Sheet-layout <-> By-teacher toggle,
// stream-coloured rows, and a Print button. The sheet layout's reassign/
// lock mechanics are migrated verbatim from the pre-split ui.js - only the
// qualified-teacher filter changed (schema v2: qualifications x subjectId,
// not the old flat t.subjects x block).

import { getData, setData } from "./store.js";
import { esc } from "./dom.js";
import { effectiveCap } from "../data.js";
import {
  buildDeploymentView,
  buildSummary,
  buildTeacherView,
  isLoadCapEnabled,
  teacherLoad,
  wouldExceedCap,
} from "../view.js";

// Local UI-only state (not persisted to `data`), same convention as
// initTabs()'s active-tab tracking in ui.js.
let viewMode = "sheet"; // 'sheet' | 'teacher'
let editWarning = ""; // Plain-language reason a manual edit was refused; cleared on the next accepted edit.

const STREAM_CLASSES = new Set(["G1", "G2", "G3", "PURE"]);

function qualifiedTeachers(data, subjectId) {
  if (!subjectId) return [];
  return (data.teachers || []).filter(
    (t) =>
      Array.isArray(t.qualifications) && t.qualifications.includes(subjectId),
  );
}

function teacherLoadLabel(data, t) {
  return `${teacherLoad(data, t.id)}/${effectiveCap(data, t)}`;
}

function renderDeployment() {
  renderSummary();
  renderBody();
}

function renderSummary() {
  const data = getData();
  const summary = buildSummary(data);
  const box = document.getElementById("deployment-summary");
  if (!box) return;

  const warningLines = [];
  if (editWarning) warningLines.push(esc(editWarning));
  if (summary.teachersOverCap.length > 0) {
    warningLines.push(
      `${esc(summary.teachersOverCap.length)} teacher(s) are over their load cap: ${summary.teachersOverCap.map((t) => `${esc(t.name)} (${esc(t.load)}/${esc(t.cap)})`).join(", ")}.` +
        (isLoadCapEnabled(data)
          ? " Solve will not accept this deployment while Load cap is ticked - unlock some assignments, raise a cap, or move a group to a teacher with spare room."
          : ""),
    );
  }
  if (summary.teachersUnderRole.length > 0) {
    warningLines.push(
      `${esc(summary.teachersUnderRole.length)} "Others" teacher(s) need a maximum-periods cap entered: ${summary.teachersUnderRole.map((t) => esc(t.name)).join(", ")}.`,
    );
  }

  box.innerHTML = `
    <div class="summary-strip">
      <div class="summary-stat"><strong>${esc(summary.groupsFilled)} / ${esc(summary.totalGroups)}</strong><br /><small>Groups filled</small></div>
      <div class="summary-stat"><strong>${esc(summary.seatsFilled)} / ${esc(summary.seatsTotal)}</strong><br /><small>Seats filled</small></div>
      <div class="summary-stat"><strong>${esc(summary.placeholderSeats)}</strong><br /><small>Placeholder seat(s)</small></div>
    </div>
    ${warningLines.length > 0 ? `<div class="status error">${warningLines.join("<br />")}</div>` : ""}
  `;
}

function renderBody() {
  if (viewMode === "teacher") renderTeacherView();
  else renderSheetView();
}

function renderSheetView() {
  const data = getData();
  const container = document.getElementById("deployment-body");
  if (!container) return;
  const view = buildDeploymentView(data);

  if (view.length === 0) {
    container.innerHTML =
      "<p>No groups yet - add some in the Groups tab, or load the sample school.</p>";
    return;
  }

  container.innerHTML = view
    .map(
      (levelEntry) => `
    <div class="deployment-level">
      <h2>Level ${esc(levelEntry.level)}</h2>
      <div class="deployment-blocks">
        ${levelEntry.blocks.map((blockEntry) => renderDeploymentBlock(data, blockEntry)).join("")}
      </div>
    </div>
  `,
    )
    .join("");
}

function renderDeploymentBlock(data, blockEntry) {
  const groupById = new Map((data.groups || []).map((g) => [g.id, g]));
  const rows = blockEntry.rows
    .map((row) => {
      const group = groupById.get(row.groupId);
      const stream =
        group && STREAM_CLASSES.has(group.stream) ? group.stream : "";
      const rowClasses = [
        !row.complete ? "row-incomplete" : "",
        row.hasPlaceholder ? "row-placeholder" : "",
        row.anyLocked ? "row-locked" : "",
        stream ? `stream-${stream.toLowerCase()}` : "",
      ]
        .filter(Boolean)
        .join(" ");

      const seats = Array.from({ length: row.teachersNeeded }, (_, seatIndex) =>
        renderSeat(data, row, group, seatIndex),
      );

      return `
      <tr class="${esc(rowClasses)}" data-group-id="${esc(row.groupId)}" data-stream="${esc(stream)}">
        <td>${esc(row.label)}${row.note ? `<br /><small>${esc(row.note)}</small>` : ""}</td>
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

function renderSeat(data, row, group, seatIndex) {
  const currentTeacherId = seatTeacherId(data, row.groupId, seatIndex);
  const subjectId = group ? group.subjectId : null;
  const options = [
    '<option value="">(none)</option>',
    ...qualifiedTeachers(data, subjectId).map(
      (t) =>
        `<option value="${esc(t.id)}" ${t.id === currentTeacherId ? "selected" : ""}>${esc(t.name)}${t.isPlaceholder ? " (placeholder)" : ` (${esc(teacherLoadLabel(data, t))})`}</option>`,
    ),
  ].join("");
  const isLocked = Boolean(
    (data.assignments || []).find(
      (a) => a.groupId === row.groupId && a.teacherId === currentTeacherId,
    )?.locked,
  );
  const currentTeacher = (data.teachers || []).find(
    (t) => t.id === currentTeacherId,
  );
  const printName = currentTeacher ? currentTeacher.name : "(none)";

  return `
    <div class="seat" data-seat-index="${esc(seatIndex)}">
      <select data-action="reassign" data-group-id="${esc(row.groupId)}" data-seat-index="${esc(seatIndex)}">${options}</select>
      <label class="lock-toggle" title="Lock this assignment so Solve never changes it">
        <input type="checkbox" data-action="toggle-lock" data-group-id="${esc(row.groupId)}" data-seat-index="${esc(seatIndex)}" ${currentTeacherId ? "" : "disabled"} ${isLocked ? "checked" : ""} />
        🔒
      </label>
      <span class="print-name">${esc(printName)}${isLocked ? " 🔒" : ""}</span>
    </div>
  `;
}

/** The teacherId currently occupying seatIndex of groupId (assignment order = seat order). */
function seatTeacherId(data, groupId, seatIndex) {
  const assignmentsForGroup = (data.assignments || []).filter(
    (a) => a.groupId === groupId,
  );
  return assignmentsForGroup[seatIndex]?.teacherId || "";
}

function renderTeacherView() {
  const data = getData();
  const container = document.getElementById("deployment-body");
  if (!container) return;
  const rows = buildTeacherView(data);

  if (rows.length === 0) {
    container.innerHTML =
      "<p>No teachers yet - add some in the Teachers tab, or load the sample school.</p>";
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Teacher</th><th>Role</th><th>Load</th><th>Groups</th></tr></thead>
        <tbody>
          ${rows
            .map((r) => {
              const pct = r.cap > 0 ? Math.min(100, (r.load / r.cap) * 100) : 0;
              return `
              <tr class="${r.isPlaceholder ? "row-placeholder" : ""}">
                <td>${esc(r.name)}${r.isPlaceholder ? " <small>(placeholder)</small>" : ""}</td>
                <td>${esc(r.roleName)}</td>
                <td>
                  <div style="display:flex;justify-content:space-between">
                    <span>${esc(r.load)} / ${esc(r.cap)}</span>
                    ${r.overCap ? "<span>&#9888; over cap</span>" : ""}
                  </div>
                  <div class="load-bar-track"><div class="load-bar-fill ${r.overCap ? "over" : ""}" style="width:${pct}%"></div></div>
                </td>
                <td>${r.groups.map((g) => `${esc(g.label)}${g.locked ? " 🔒" : ""}`).join("<br />") || "<small>(none)</small>"}</td>
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function wireDeployment() {
  const toggleButtons = document.querySelectorAll(
    '[data-action="view-sheet"], [data-action="view-teacher"]',
  );
  toggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      viewMode = btn.dataset.action === "view-teacher" ? "teacher" : "sheet";
      toggleButtons.forEach((b) => b.classList.toggle("active", b === btn));
      renderBody();
    });
  });

  const printBtn = document.getElementById("btn-print");
  if (printBtn) printBtn.addEventListener("click", () => window.print());

  const container = document.getElementById("deployment-body");
  container.addEventListener("change", (e) => {
    const groupId = e.target.dataset.groupId;
    if (!groupId) return;
    const seatIndex = Number(e.target.dataset.seatIndex);
    const data = getData();
    let assignmentsForGroup = (data.assignments || []).filter(
      (a) => a.groupId === groupId,
    );
    const others = (data.assignments || []).filter(
      (a) => a.groupId !== groupId,
    );

    if (e.target.dataset.action === "reassign") {
      const newTeacherId = e.target.value;
      const currentTeacherId = seatTeacherId(data, groupId, seatIndex);
      if (
        newTeacherId &&
        newTeacherId !== currentTeacherId &&
        isLoadCapEnabled(data)
      ) {
        const check = wouldExceedCap(data, newTeacherId, groupId);
        if (check.exceeds) {
          const t = data.teachers.find((x) => x.id === newTeacherId);
          editWarning = `${t.name} can't take this group: it would bring their load to ${check.newLoad}, over their cap of ${check.cap}. Pick a teacher with spare room, or untick Load cap in the Layers tab.`;
          renderSummary();
          renderBody(); // Snap the dropdown back to the current teacher.
          return;
        }
      }
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

    editWarning = "";
    setData({ ...data, assignments: [...others, ...assignmentsForGroup] });
  });
}

export { renderDeployment, wireDeployment };
