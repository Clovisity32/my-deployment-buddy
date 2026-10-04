// Board tab: subject cards with one row per group, a seat (teacher picker +
// lock) per teacher needed, and a live per-teacher tally. Rendering and event
// wiring only; every decision lives in src/board.js, which returns
// `{ data, error }`. commit() is the single place a result is applied.

import { getData, setData } from "./store.js";
import { esc, genId } from "./dom.js";
import { bigThreshold } from "../data.js";
import { createHistory } from "../history.js";
import { blockFromDiscipline } from "../setup.js";
import { applyContinuity } from "../continuity.js";
import {
  buildBoard,
  buildTally,
  addGroup,
  deleteGroup,
  duplicateGroup,
  splitGroup,
  combineGroups,
  updateGroup,
  clearGroupSeats,
  assignSeat,
  assignToTeacher,
  dropSeat,
  toggleLock,
} from "../board.js";

const STREAM_CLASSES = new Set(["G1", "G2", "G3", "PURE"]);
const STREAMS = ["", "G1", "G2", "G3", "PURE"];
const LEVELS = [1, 2, 3, 4, 5];

let arrange = "subject"; // "subject" | "level"
let highlightTeacherId = "";
let openDetailsId = "";
let quickLevel = 3;
let toastTimer = null;
let dragSource = null; // {groupId, seatIndex} while a teacher chip is being dragged

// ---------------------------------------------------------------------------
// Feedback and applying results
// ---------------------------------------------------------------------------

function toast(message, kind = "ok") {
  const el = document.getElementById("board-toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 5000);
}

/**
 * Apply the result of a board operation. On a refusal, say why and redraw so
 * a dropdown snaps back; otherwise save it. Returns true if it was applied.
 */
/** The skipped-rows list goes stale as soon as the HOD does anything else. */
function clearContinuityReport() {
  const report = document.getElementById("board-continuity-report");
  if (report) report.innerHTML = "";
}

function commit(result, successMessage) {
  clearContinuityReport();
  if (result.error) {
    toast(result.error, "error");
    renderBoard();
    return false;
  }
  if (result.data === getData()) return true;
  recordUndoPoint();
  setData(result.data);
  const message = successMessage || result.notice;
  if (message) toast(message, "ok");
  return true;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

const history = createHistory();

/** Remember the current board state so the next change (or a solve) can be undone. */
function recordUndoPoint() {
  history.record(getData());
}

/** Forget all undo/redo steps. Call whenever the whole dataset is replaced. */
function resetHistory() {
  history.reset();
}

function undo() {
  clearContinuityReport();
  const next = history.undo(getData());
  if (!next) {
    toast("Nothing to undo yet.", "error");
    return;
  }
  setData(next);
  toast("Undone.", "ok");
}

function redo() {
  clearContinuityReport();
  const next = history.redo(getData());
  if (!next) {
    toast("Nothing to redo.", "error");
    return;
  }
  setData(next);
  toast("Redone.", "ok");
}

function wireHistoryKeys(panel) {
  document.addEventListener("keydown", (e) => {
    if (!panel.classList.contains("active")) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName))
      return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (key === "y" || (key === "z" && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  });
}

function qualifiedFor(data, row) {
  return (data.teachers || []).filter(
    (t) => !row.subjectId || (t.qualifications || []).includes(row.subjectId),
  );
}

/** Subjects offered at `level` (and, if given, belonging to the `block`). */
function subjectsFor(data, level, block) {
  return (data.subjects || []).filter(
    (s) =>
      (s.levels || []).includes(level) &&
      (block === undefined ||
        (blockFromDiscipline(s.discipline) || "Other") === block),
  );
}

function renderSeat(data, row, idx, tallyById) {
  const seat = row.seats[idx] || null;
  const qualified = qualifiedFor(data, row);
  const options = [
    '<option value="">(none)</option>',
    ...qualified.map((t) => {
      const r = tallyById.get(t.id);
      const label = r
        ? `${t.name} · ${r.load}/${r.cap} · ${r.big}B ${r.small}S`
        : t.name;
      return `<option value="${esc(t.id)}" ${seat && seat.teacherId === t.id ? "selected" : ""}>${esc(label)}</option>`;
    }),
  ];
  if (seat && !qualified.some((t) => t.id === seat.teacherId)) {
    options.push(
      `<option value="${esc(seat.teacherId)}" selected>${esc(seat.teacherName)} (not qualified)</option>`,
    );
  }
  const highlight =
    seat && seat.teacherId === highlightTeacherId ? " highlight" : "";
  const grip =
    seat && !seat.locked
      ? `<span class="grip" draggable="true" title="Drag to move or swap" aria-label="Drag ${esc(seat.teacherName)} to another class">&#10303;</span>`
      : '<span class="grip-spacer"></span>';
  return `
    <div class="seat${seat && seat.locked ? " seat-locked" : ""}${highlight}" data-group-id="${esc(row.groupId)}" data-seat-index="${esc(idx)}">
      ${grip}
      <select data-action="reassign" data-group-id="${esc(row.groupId)}" data-seat-index="${esc(idx)}" aria-label="Teacher for ${esc(row.name)}">${options.join("")}</select>
      <label class="lock-toggle" title="Lock this assignment so Solve never changes it">
        <input type="checkbox" data-action="toggle-lock" data-group-id="${esc(row.groupId)}" data-seat-index="${esc(idx)}" ${seat ? "" : "disabled"} ${seat && seat.locked ? "checked" : ""} />
        &#128274;
      </label>
      <span class="print-name">${esc(seat ? seat.teacherName : "(none)")}${seat && seat.locked ? " &#128274;" : ""}</span>
    </div>`;
}

function renderDetails(data, row, card) {
  const classes = (data.classes || []).filter((c) => c.level === row.level);
  const siblings = card.rows.filter(
    (r) => r.groupId !== row.groupId && r.subjectId === row.subjectId,
  );
  const id = esc(row.groupId);
  return `
    <div class="row-details" data-group-id="${id}">
      <label>Name <input data-action="detail-field" data-field="label" data-group-id="${id}" value="${esc(row.manualLabel ? row.name : "")}" placeholder="${esc(row.name)}" /></label>
      <label>Periods <input data-action="detail-field" data-field="periods" data-group-id="${id}" type="number" min="1" value="${esc(row.periods)}" style="width:4em" /></label>
      <label>Teachers needed <input data-action="detail-field" data-field="teachersNeeded" data-group-id="${id}" type="number" min="1" value="${esc(row.teachersNeeded)}" style="width:4em" /></label>
      <label>Stream
        <select data-action="detail-field" data-field="stream" data-group-id="${id}">
          ${STREAMS.map((s) => `<option value="${esc(s)}" ${s === row.stream ? "selected" : ""}>${esc(s || "(none)")}</option>`).join("")}
        </select>
      </label>
      <fieldset class="detail-classes"><legend>Classes in this group</legend>
        ${
          classes.length === 0
            ? "<small>No classes at this level yet.</small>"
            : classes
                .map(
                  (c) =>
                    `<label><input type="checkbox" data-action="detail-class" data-group-id="${id}" value="${esc(c.id)}" ${row.classIds.includes(c.id) ? "checked" : ""} /> ${esc(c.id)}</label>`,
                )
                .join(" ")
        }
      </fieldset>
      <label>Note <input data-action="detail-field" data-field="note" data-group-id="${id}" value="${esc(row.note)}" /></label>
      <div class="detail-buttons">
        <button data-action="duplicate-group" data-group-id="${id}">Duplicate group</button>
        ${row.classIds.length > 1 ? `<button data-action="split-group" data-group-id="${id}">Split into one group per class</button>` : ""}
        ${
          siblings.length > 0
            ? `<select data-action="combine-with" data-group-id="${id}"><option value="">Combine with…</option>${siblings.map((s) => `<option value="${esc(s.groupId)}">${esc(s.name)}</option>`).join("")}</select>`
            : ""
        }
        ${row.seats.length > 0 ? `<button data-action="clear-teachers" data-group-id="${id}">Remove teachers from this group</button>` : ""}
        <button class="danger" data-action="delete-group" data-group-id="${id}">Delete group</button>
      </div>
    </div>`;
}

function renderRow(data, row, tallyById, card) {
  const stream = STREAM_CLASSES.has(row.stream) ? row.stream : "";
  const seatCount = Math.max(row.teachersNeeded, row.seats.length);
  const seats = Array.from({ length: seatCount }, (_, i) =>
    renderSeat(data, row, i, tallyById),
  ).join("");
  const classes = [
    "board-row",
    stream ? `stream-${stream.toLowerCase()}` : "",
    row.complete ? "" : "row-incomplete",
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <div class="${esc(classes)}" data-group-id="${esc(row.groupId)}" data-stream="${esc(stream)}">
      <div class="row-main">
        <span class="row-name">${esc(row.name)}</span>
        <button class="icon" data-action="toggle-details" data-group-id="${esc(row.groupId)}" aria-label="More options for ${esc(row.name)}" title="More options">&#8943;</button>
        <span class="row-meta">${esc(row.periods)}p <span class="size-badge ${row.isBig ? "big" : ""}">${row.isBig ? "BIG" : "sm"}</span>${row.teachersNeeded > 1 ? '<span class="team-badge" title="Team-taught: each teacher carries the full periods">&#8644; team</span>' : ""}</span>
      </div>
      <div class="row-seats">${seats}</div>
      ${row.note ? `<div class="row-note">${esc(row.note)}</div>` : ""}
      ${row.warnings.length > 0 ? `<ul class="row-warnings">${row.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      ${openDetailsId === row.groupId ? renderDetails(data, row, card) : ""}
    </div>`;
}

function renderCardAdd(data, card) {
  const subjects = subjectsFor(data, card.level, card.block);
  if (subjects.length === 0) return "";
  return `<select class="card-add" data-action="add-group-card" data-level="${esc(card.level)}" aria-label="Add a group to ${esc(card.title)}">
    <option value="">+ add group…</option>
    ${subjects.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}
  </select>`;
}

function renderBody(data, board, tallyById) {
  if (board.sections.length === 0) {
    return '<p>No groups yet - pick a level and subject above and press "Add group", or load the sample school.</p>';
  }
  return board.sections
    .map(
      (section) => `
    <section class="board-section">
      <h2>${esc(section.title)}</h2>
      <div class="board-cards">
        ${section.cards
          .map(
            (card) => `
          <div class="board-card" data-key="${esc(card.key)}" data-level="${esc(card.level)}" data-block="${esc(card.block)}">
            <h3>${esc(card.title)}</h3>
            ${card.rows.map((row) => renderRow(data, row, tallyById, card)).join("")}
            ${renderCardAdd(data, card)}
          </div>`,
          )
          .join("")}
      </div>
    </section>`,
    )
    .join("");
}

function renderSummary(tally) {
  const t = tally.totals;
  const lines = [];
  if (t.teachersOverCap.length > 0) {
    lines.push(
      `${esc(t.teachersOverCap.length)} teacher(s) are over their load cap: ${t.teachersOverCap.map((x) => `${esc(x.name)} (${esc(x.load)}/${esc(x.cap)})`).join(", ")}. Solve will not accept this while Load cap is ticked - move a class to someone with room, or raise a cap.`,
    );
  }
  if (t.teachersNeedingCap.length > 0) {
    lines.push(
      `${esc(t.teachersNeedingCap.length)} "Others" teacher(s) need a maximum-periods cap entered: ${t.teachersNeedingCap.map((x) => esc(x.name)).join(", ")}.`,
    );
  }
  return `
    <div class="summary-strip">
      <div class="summary-stat"><strong>${esc(t.groupsFilled)} / ${esc(t.groupCount)}</strong><br /><small>Groups filled</small></div>
      <div class="summary-stat"><strong>${esc(t.seatsFilled)} / ${esc(t.seatsTotal)}</strong><br /><small>Seats filled</small></div>
      <div class="summary-stat"><strong>${esc(t.demand)} / ${esc(t.capacity)}</strong><br /><small>Demand / capacity (periods)</small></div>
      <div class="summary-stat"><strong>${esc(t.spreadPct)} pts</strong><br /><small>Load spread (highest - lowest %)</small></div>
      <div class="summary-stat"><strong>${esc(t.placeholderSeats)}</strong><br /><small>Placeholder seat(s)</small></div>
    </div>
    ${lines.length > 0 ? `<div class="status error">${lines.join("<br />")}</div>` : ""}`;
}

function renderTally(tally) {
  if (tally.rows.length === 0) {
    return "<p>No teachers yet - add some on the Teachers tab, or load the sample school.</p>";
  }
  return `
    <table class="tally">
      <thead><tr><th>Teacher</th><th>Periods</th><th title="Big groups">Big</th><th title="Small groups">Small</th><th title="Number of classes">Classes</th><th>Status</th></tr></thead>
      <tbody>
        ${tally.rows
          .map(
            (r) => `
          <tr class="tally-row${r.teacherId === highlightTeacherId ? " selected" : ""}${r.isPlaceholder ? " row-placeholder" : ""}" data-teacher-id="${esc(r.teacherId)}" title="Click to highlight this teacher's classes. Drop a class here to give it to them.">
            <td>${esc(r.name)}<br /><small>${esc(r.roleName)}</small></td>
            <td>${esc(r.load)} / ${esc(r.cap)} <small>(${esc(r.pct)}%)</small>
              <div class="load-bar-track"><div class="load-bar-fill ${r.statusKind === "over" ? "over" : ""}" style="width:${Math.min(100, r.pct)}%"></div></div></td>
            <td>${esc(r.big)}</td>
            <td>${esc(r.small)}</td>
            <td>${esc(r.classes)}</td>
            <td><span class="status-chip ${esc(r.statusKind)}">${esc(r.statusText)}</span></td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>`;
}

/** The toolbar's level + subject quick-add; keeps the chosen subject across redraws. */
function renderQuickAdd() {
  const box = document.getElementById("board-quickadd");
  if (!box) return;
  const data = getData();
  const chosen = box.querySelector("#quick-subject")?.value || "";
  const subjects = subjectsFor(data, quickLevel);
  box.innerHTML = `
    <label>Level <select id="quick-level" data-action="quick-level">${LEVELS.map((l) => `<option value="${esc(l)}" ${l === quickLevel ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
    <label>Subject <select id="quick-subject">${subjects.map((s) => `<option value="${esc(s.id)}" ${s.id === chosen ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
    <button data-action="quick-add">Add group</button>`;
}

function renderBoard() {
  const body = document.getElementById("board-body");
  if (!body) return;
  const data = getData();
  const board = buildBoard(data, arrange);
  const tally = buildTally(data);
  const tallyById = new Map(tally.rows.map((r) => [r.teacherId, r]));
  document.getElementById("board-summary").innerHTML = renderSummary(tally);
  body.innerHTML = renderBody(data, board, tallyById);
  document.getElementById("board-tally").innerHTML = renderTally(tally);
  const tray = document.getElementById("board-unassigned");
  if (tray) {
    tray.textContent =
      tally.totals.unfilledSeats > 0
        ? `${tally.totals.unfilledSeats} seat(s) still unassigned. Drop a class here to clear its teacher.`
        : "Every seat is filled. Drop a class here to clear its teacher.";
  }
  renderQuickAdd();
  const big = document.getElementById("board-big-periods");
  if (big && document.activeElement !== big) big.value = bigThreshold(data);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function groupIdOf(el) {
  return (
    el.dataset.groupId || el.closest("[data-group-id]")?.dataset.groupId || ""
  );
}

function wireBoard() {
  const panel = document.getElementById("panel-board");
  wireDragAndDrop(panel);
  wireHistoryKeys(panel);

  panel.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    const action = el?.dataset.action;
    const data = getData();
    const id = el ? groupIdOf(el) : "";
    if (action && action !== "apply-continuity") clearContinuityReport();

    if (action === "arrange-subject" || action === "arrange-level") {
      arrange = action === "arrange-level" ? "level" : "subject";
      panel
        .querySelectorAll('[data-action^="arrange-"]')
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.action === action),
        );
      renderBoard();
    } else if (action === "undo") {
      undo();
    } else if (action === "redo") {
      redo();
    } else if (action === "print") {
      window.print();
    } else if (action === "apply-continuity") {
      const report = document.getElementById("board-continuity-report");
      const res = applyContinuity(data);
      const lines = res.skipped
        .map((s) => `<li>${esc(s.message)}</li>`)
        .join("");
      if (res.added === 0) {
        if (report)
          report.innerHTML = lines ? `<ul class="problems">${lines}</ul>` : "";
        toast(
          res.skipped.length > 0
            ? "Nothing could be locked - see the reasons below the toolbar."
            : "No last-year teachers to lock yet. Add them under Teachers → Intake from Excel → Last year's teachers.",
          "error",
        );
        return;
      }
      if (
        !confirm(
          `Lock ${res.added} placement(s) from last year (Sec 1 to 2 and Sec 3 to 4)?

${res.skipped.length} will be skipped. Seats you have already placed are left as they are.`,
        )
      )
        return;
      if (
        commit(
          { data: res.data, error: null },
          `Locked ${res.added} placement(s) from last year. ${res.skipped.length} skipped.`,
        )
      ) {
        if (report)
          report.innerHTML = lines
            ? `<p>Skipped:</p><ul class="problems">${lines}</ul>`
            : "";
      }
    } else if (action === "toggle-details") {
      openDetailsId = openDetailsId === id ? "" : id;
      renderBoard();
    } else if (action === "quick-add") {
      const subjectId = document.getElementById("quick-subject")?.value;
      commit(
        addGroup(data, { level: quickLevel, subjectId, id: genId("g") }),
        "Group added.",
      );
    } else if (action === "duplicate-group") {
      commit(duplicateGroup(data, id, genId("g")), "Group duplicated.");
    } else if (action === "split-group") {
      commit(
        splitGroup(data, id, () => genId("g")),
        "Split into one group per class.",
      );
    } else if (action === "clear-teachers") {
      commit(clearGroupSeats(data, id), "Teachers removed from this group.");
    } else if (action === "delete-group") {
      const group = (data.groups || []).find((g) => g.id === id);
      const seats = (data.assignments || []).filter(
        (a) => a.groupId === id,
      ).length;
      const name = group ? group.label : "this group";
      const message =
        seats > 0
          ? `Delete "${name}"?\n\nIts ${seats} teacher assignment(s) will be removed too.`
          : `Delete "${name}"?`;
      if (confirm(message)) {
        openDetailsId = "";
        commit(deleteGroup(data, id), "Group deleted.");
      }
    } else if (!action) {
      const tallyRow = e.target.closest(".tally-row");
      if (tallyRow) {
        const tid = tallyRow.dataset.teacherId;
        highlightTeacherId = highlightTeacherId === tid ? "" : tid;
        renderBoard();
      }
    }
  });

  panel.addEventListener("change", (e) => {
    const el = e.target;
    const action = el.dataset.action;
    const data = getData();
    if (action === "reassign") {
      commit(
        assignSeat(
          data,
          el.dataset.groupId,
          Number(el.dataset.seatIndex),
          el.value,
        ),
      );
    } else if (action === "toggle-lock") {
      commit(
        toggleLock(data, el.dataset.groupId, Number(el.dataset.seatIndex)),
      );
    } else if (action === "add-group-card") {
      if (!el.value) return;
      commit(
        addGroup(data, {
          level: Number(el.dataset.level),
          subjectId: el.value,
          id: genId("g"),
        }),
        "Group added.",
      );
    } else if (action === "quick-level") {
      quickLevel = Number(el.value);
      renderQuickAdd();
    } else if (action === "detail-field") {
      commit(
        updateGroup(data, el.dataset.groupId, {
          [el.dataset.field]: el.value,
        }),
      );
    } else if (action === "detail-class") {
      const box = el.closest(".row-details");
      const classIds = [
        ...box.querySelectorAll('input[data-action="detail-class"]:checked'),
      ].map((c) => c.value);
      commit(updateGroup(data, el.dataset.groupId, { classIds }));
    } else if (action === "combine-with") {
      if (!el.value) return;
      commit(
        combineGroups(data, [el.dataset.groupId, el.value], {}),
        "Groups combined.",
      );
    } else if (action === "set-big-periods") {
      const n = Number(el.value);
      if (!Number.isInteger(n) || n < 1) {
        toast(
          "Enter a whole number of 1 or more for the big/small cut-off.",
          "error",
        );
        el.value = bigThreshold(data);
        return;
      }
      setData({
        ...data,
        settings: { ...(data.settings || {}), bigPeriods: n },
      });
      toast(`Groups of ${n}+ periods now count as big.`, "ok");
    }
  });
}

/**
 * Native HTML5 drag-and-drop. Source: a seat's grip. Targets: another seat or
 * row (move into a free seat, or swap), a teacher in the tally (give them the
 * class), or the tray (clear the seat). The pickers stay as the keyboard path.
 */
function wireDragAndDrop(panel) {
  const clearMarks = () =>
    panel
      .querySelectorAll(".dragging, .drop-target, .over")
      .forEach((n) => n.classList.remove("dragging", "drop-target", "over"));

  panel.addEventListener("dragstart", (e) => {
    const grip = e.target.closest?.(".grip");
    if (!grip) return;
    const seat = grip.closest(".seat");
    dragSource = {
      groupId: seat.dataset.groupId,
      seatIndex: Number(seat.dataset.seatIndex),
    };
    e.dataTransfer.setData("text/plain", JSON.stringify(dragSource));
    e.dataTransfer.effectAllowed = "move";
    seat.classList.add("dragging");
  });

  panel.addEventListener("dragover", (e) => {
    if (!dragSource) return;
    const target = e.target.closest?.(
      ".seat, .board-row, .tally-row, #board-unassigned",
    );
    if (!target) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    panel
      .querySelectorAll(".drop-target, .over")
      .forEach((n) => n.classList.remove("drop-target", "over"));
    target.classList.add(
      target.id === "board-unassigned" ? "over" : "drop-target",
    );
  });

  panel.addEventListener("dragend", () => {
    dragSource = null;
    clearMarks();
  });

  panel.addEventListener("drop", (e) => {
    if (!dragSource) return;
    e.preventDefault();
    const from = dragSource;
    dragSource = null;
    clearMarks();
    const data = getData();
    const nameOf = (teacherId) =>
      (data.teachers || []).find((t) => t.id === teacherId)?.name ||
      "That teacher";
    const mover = (data.assignments || []).filter(
      (a) => a.groupId === from.groupId,
    )[from.seatIndex];

    const seatEl = e.target.closest(".seat");
    const rowEl = e.target.closest(".board-row");
    const tallyEl = e.target.closest(".tally-row");
    if (e.target.closest("#board-unassigned")) {
      commit(
        assignSeat(data, from.groupId, from.seatIndex, ""),
        mover ? `Removed ${nameOf(mover.teacherId)} from that class.` : "",
      );
    } else if (tallyEl) {
      commit(
        assignToTeacher(data, from, tallyEl.dataset.teacherId),
        `Gave that class to ${nameOf(tallyEl.dataset.teacherId)}.`,
      );
    } else if (seatEl || rowEl) {
      const groupId = (seatEl || rowEl).dataset.groupId;
      let seatIndex;
      if (seatEl) {
        seatIndex = Number(seatEl.dataset.seatIndex);
      } else {
        const filled = (data.assignments || []).filter(
          (a) => a.groupId === groupId,
        ).length;
        const needed =
          (data.groups || []).find((g) => g.id === groupId)?.teachersNeeded ??
          1;
        seatIndex = filled < needed ? filled : 0;
      }
      const target = (data.assignments || []).filter(
        (a) => a.groupId === groupId,
      )[seatIndex];
      commit(
        dropSeat(data, from, { groupId, seatIndex }),
        target
          ? `Swapped ${nameOf(mover?.teacherId)} and ${nameOf(target.teacherId)}.`
          : `Moved ${nameOf(mover?.teacherId)}.`,
      );
    }
  });
}

export { renderBoard, wireBoard, recordUndoPoint, resetHistory };
