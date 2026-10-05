// Pure board logic for the Workbench tab. Every function takes `data` and
// returns a value or a NEW data object; nothing here touches the DOM or the
// store, so it is unit-testable under `node --test`. Edit operations return
// `{ data, error }`: on refusal `data` is the same object that went in and
// `error` is a plain-language sentence for the toast.

import { bigThreshold, isDenied } from "./data.js";
import { blockFromDiscipline, rebuildGroups } from "./setup.js";
import { blockSortKey, buildSummary, buildTeacherView } from "./view.js";
import { isSet } from "./layers/groupCount.js";

const STREAM_ORDER = ["G1", "G2", "G3", "PURE"];

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function streamRank(stream) {
  const i = STREAM_ORDER.indexOf(stream);
  return i === -1 ? STREAM_ORDER.length : i;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Auto-built name: "S3 Phy 3E1", or "S3 Phy G2 (3E1+3E2)" once there is a
 * stream or more than one class.
 * @param {any} g
 */
function groupLabel(g) {
  const classIds = Array.isArray(g.classIds) ? g.classIds : [];
  const classes = classIds.join("+");
  const parts = [`S${g.level}`, g.block];
  if (g.stream) parts.push(g.stream);
  if (classes) {
    parts.push(g.stream || classIds.length > 1 ? `(${classes})` : classes);
  }
  return parts.join(" ");
}

/**
 * The name each group should display, in the same order as `groups`. A group
 * the HOD named by hand (manualLabel) keeps its label; identical auto names
 * get " #1", " #2", ... in list order so no two rows look the same.
 * @param {any[]} groups
 * @returns {string[]}
 */
function autoLabels(groups) {
  const bases = groups.map((g) => (g.manualLabel ? null : groupLabel(g)));
  const totals = new Map();
  bases.forEach((base) => {
    if (base !== null) totals.set(base, (totals.get(base) || 0) + 1);
  });
  const seen = new Map();
  return groups.map((g, i) => {
    const base = bases[i];
    if (base === null) return g.label;
    if (totals.get(base) > 1) {
      const k = (seen.get(base) || 0) + 1;
      seen.set(base, k);
      return `${base} #${k}`;
    }
    return base;
  });
}

/**
 * Mark groups whose label the HOD typed (an old custom group, a label
 * override) as manual so auto-naming leaves them alone.
 * @param {any} data
 * @param {any[]} groups
 */
function markTypedLabels(data, groups) {
  const customIds = new Set((data?.customGroups || []).map((g) => g.id));
  return groups.map((g) => {
    const typed =
      (customIds.has(g.id) && g.label) || data?.groupOverrides?.[g.id]?.label;
    return typed && !g.manualLabel ? { ...g, manualLabel: true } : g;
  });
}

/** @param {any[]} groups @returns {any[]} groups whose `label` is up to date */
function relabel(groups) {
  const labels = autoLabels(groups);
  return groups.map((g, i) =>
    g.label === labels[i] ? g : { ...g, label: labels[i] },
  );
}

// ---------------------------------------------------------------------------
// Small helpers shared by the read-model and the edit operations
// ---------------------------------------------------------------------------

/** A teacher is qualified for a group when it has no subject, or the teacher lists that subject. */
function isQualified(teacher, group) {
  return (
    !group.subjectId || (teacher.qualifications || []).includes(group.subjectId)
  );
}

/**
 * The name the board shows for a group. Messages use this, not `group.label`,
 * which can still hold an old-style name until the board owns the groups.
 */
function displayName(data, group) {
  const groups = data.groupsFrozen
    ? data.groups
    : markTypedLabels(data, data.groups || []);
  const i = groups.findIndex((g) => g.id === group.id);
  return i === -1 ? group.label || group.id : autoLabels(groups)[i];
}

const ok = (data) => ({ data, error: null });
const fail = (data, error) => ({ data, error });
const findGroup = (data, id) => (data.groups || []).find((g) => g.id === id);
const findTeacher = (data, id) =>
  (data.teachers || []).find((t) => t.id === id);
const seatsOf = (data, groupId) =>
  (data.assignments || []).filter((a) => a.groupId === groupId);

// ---------------------------------------------------------------------------
// Read-model: the board
// ---------------------------------------------------------------------------

function compareRows(a, b) {
  return (
    streamRank(a.stream) - streamRank(b.stream) ||
    (a.classIds.length === 0) - (b.classIds.length === 0) ||
    naturalCompare(a.classIds.join(","), b.classIds.join(",")) ||
    naturalCompare(a.name, b.name)
  );
}

/**
 * @param {any} data
 * @param {"subject"|"level"} [arrange]
 */
function buildBoard(data, arrange = "subject") {
  const rawGroups = Array.isArray(data?.groups) ? data.groups : [];
  // Before the board owns the groups, a name the HOD typed (a custom group, a
  // label override) must still show as typed, not be replaced by an auto-name.
  const groups = data?.groupsFrozen
    ? rawGroups
    : markTypedLabels(data, rawGroups);
  const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
  const teacherById = new Map((data?.teachers || []).map((t) => [t.id, t]));
  const names = autoLabels(groups);
  const threshold = bigThreshold(data);

  const bandGroupIds = new Map();
  for (const g of groups) {
    if (!g.bandId) continue;
    if (!bandGroupIds.has(g.bandId)) bandGroupIds.set(g.bandId, new Set());
    bandGroupIds.get(g.bandId).add(g.id);
  }

  const cards = new Map();
  groups.forEach((g, i) => {
    const name = names[i];
    const seats = assignments
      .filter((a) => a.groupId === g.id)
      .map((a, index) => {
        const t = teacherById.get(a.teacherId);
        return {
          index,
          teacherId: a.teacherId,
          teacherName: t ? t.name : a.teacherId,
          locked: Boolean(a.locked),
          placeholder: Boolean(t && t.isPlaceholder),
          qualified: t ? isQualified(t, g) : true,
          denied: t ? isDenied(t, g) : false,
        };
      });

    const warnings = [];
    if (seats.length < g.teachersNeeded) {
      warnings.push(
        `Needs ${g.teachersNeeded - seats.length} more teacher(s).`,
      );
    }
    for (const s of seats) {
      if (!s.qualified)
        warnings.push(`${s.teacherName} isn't qualified for this subject.`);
      if (s.denied)
        warnings.push(
          `${s.teacherName} is on the deny list for this group, so Solve will not keep this placement.`,
        );
      const inBand = g.bandId ? bandGroupIds.get(g.bandId) : null;
      if (
        inBand &&
        assignments.some(
          (a) =>
            a.teacherId === s.teacherId &&
            a.groupId !== g.id &&
            inBand.has(a.groupId),
        )
      ) {
        warnings.push(
          `${s.teacherName} is also teaching another group in this band at the same time.`,
        );
      }
    }

    const classIds = Array.isArray(g.classIds) ? g.classIds : [];
    const row = {
      groupId: g.id,
      name,
      level: g.level,
      block: g.block,
      subjectId: g.subjectId || null,
      periods: g.periods,
      isBig: g.periods >= threshold,
      stream: g.stream || "",
      classIds,
      teachersNeeded: g.teachersNeeded,
      note: g.note || "",
      manualLabel: Boolean(g.manualLabel),
      seats,
      complete: seats.length >= g.teachersNeeded,
      warnings,
    };
    const key = `${g.level}|${g.block}`;
    if (!cards.has(key)) {
      cards.set(key, {
        key,
        level: g.level,
        block: g.block,
        title: `${g.block} · Sec ${g.level}`,
        rows: [],
      });
    }
    cards.get(key).rows.push(row);
  });
  for (const card of cards.values()) card.rows.sort(compareRows);

  const bySubject = arrange === "subject";
  const sections = new Map();
  for (const card of cards.values()) {
    const key = bySubject ? card.block : String(card.level);
    if (!sections.has(key)) {
      sections.set(key, {
        key,
        title: bySubject ? card.block : `Sec ${card.level}`,
        cards: [],
      });
    }
    sections.get(key).cards.push(card);
  }
  const out = [...sections.values()].sort(
    bySubject
      ? (a, c) =>
          blockSortKey(a.key) - blockSortKey(c.key) ||
          a.key.localeCompare(c.key)
      : (a, c) => Number(a.key) - Number(c.key),
  );
  out.forEach((s) =>
    s.cards.sort(
      bySubject
        ? (a, c) => a.level - c.level
        : (a, c) =>
            blockSortKey(a.block) - blockSortKey(c.block) ||
            a.block.localeCompare(c.block),
    ),
  );
  return { arrange, sections: out };
}

// ---------------------------------------------------------------------------
// Group operations (all freeze the board's group list and relabel)
// ---------------------------------------------------------------------------

function withGroups(data, groups, assignments = data.assignments || []) {
  // The first structural edit is the moment the board takes the groups over:
  // protect typed names (e.g. the sample's custom "Enrichment" group) once.
  const kept = data.groupsFrozen ? groups : markTypedLabels(data, groups);
  return { ...data, groupsFrozen: true, groups: relabel(kept), assignments };
}

/** @param {any} data @param {{level:number, subjectId:string, id:string}} opts */
function addGroup(data, { level, subjectId, id }) {
  const subject = (data.subjects || []).find((s) => s.id === subjectId);
  if (!subject)
    return fail(data, "Pick a subject first, then press Add group.");
  if (!Number.isInteger(level))
    return fail(data, "Pick a level first, then press Add group.");
  const group = {
    id,
    level,
    block: blockFromDiscipline(subject.discipline) || "Other",
    label: "",
    periods: subject.periods,
    band: null,
    teachersNeeded: 1,
    category: subject.stream || "",
    note: "",
    subjectId: subject.id,
    discipline: subject.discipline || "",
    stream: subject.stream || "",
    classIds: [],
    bandId: null,
  };
  return ok(withGroups(data, [...(data.groups || []), group]));
}

function deleteGroup(data, groupId) {
  if (!findGroup(data, groupId))
    return fail(data, "That group no longer exists.");
  return ok(
    withGroups(
      data,
      data.groups.filter((g) => g.id !== groupId),
      (data.assignments || []).filter((a) => a.groupId !== groupId),
    ),
  );
}

function duplicateGroup(data, groupId, newId) {
  const i = (data.groups || []).findIndex((g) => g.id === groupId);
  if (i === -1) return fail(data, "That group no longer exists.");
  const groups = [...data.groups];
  groups.splice(i + 1, 0, { ...groups[i], id: newId });
  return ok(withGroups(data, groups));
}

/** One group per class. The first keeps the original id (and its teacher). */
function splitGroup(data, groupId, idFn) {
  const i = (data.groups || []).findIndex((g) => g.id === groupId);
  if (i === -1) return fail(data, "That group no longer exists.");
  const { manualLabel, ...base } = data.groups[i];
  const classIds = base.classIds || [];
  if (classIds.length < 2) {
    return fail(
      data,
      "This group has only one class, so there is nothing to split.",
    );
  }
  const parts = classIds.map((c, k) => ({
    ...base,
    id: k === 0 ? base.id : idFn(),
    classIds: [c],
    band: null,
    bandId: null,
  }));
  const groups = [...data.groups];
  groups.splice(i, 1, ...parts);
  return ok(withGroups(data, groups));
}

/** Merge groups of the same subject and level into the first one. */
function combineGroups(data, groupIds, { stream } = {}) {
  const picked = groupIds.map((id) => findGroup(data, id)).filter(Boolean);
  if (picked.length < 2)
    return fail(data, "Pick at least two groups to combine.");
  if (new Set(picked.map((g) => `${g.level}|${g.subjectId}`)).size !== 1) {
    return fail(
      data,
      "Only groups of the same subject and level can be combined.",
    );
  }
  const [first, ...rest] = picked;
  const dropIds = new Set(rest.map((g) => g.id));
  const classIds = [...new Set(picked.flatMap((g) => g.classIds || []))].sort(
    naturalCompare,
  );
  const nextStream = stream === undefined ? first.stream || "" : stream;
  const merged = {
    ...first,
    classIds,
    band: null,
    bandId: null,
    stream: nextStream,
    category: nextStream,
  };
  return ok(
    withGroups(
      data,
      data.groups
        .filter((g) => !dropIds.has(g.id))
        .map((g) => (g.id === first.id ? merged : g)),
      (data.assignments || []).filter((a) => !dropIds.has(a.groupId)),
    ),
  );
}

/** @param {any} patch any of periods, teachersNeeded, note, stream, classIds, label */
function updateGroup(data, groupId, patch) {
  const group = findGroup(data, groupId);
  if (!group) return fail(data, "That group no longer exists.");
  const next = { ...group };
  if ("periods" in patch) {
    const n = Number(patch.periods);
    if (!Number.isInteger(n) || n < 1)
      return fail(data, "Periods must be a whole number of 1 or more.");
    next.periods = n;
  }
  if ("teachersNeeded" in patch) {
    const n = Number(patch.teachersNeeded);
    if (!Number.isInteger(n) || n < 1)
      return fail(data, "Teachers needed must be a whole number of 1 or more.");
    next.teachersNeeded = n;
  }
  if ("note" in patch) next.note = String(patch.note);
  if ("stream" in patch) {
    next.stream = String(patch.stream);
    next.category = next.stream;
  }
  if ("classIds" in patch)
    next.classIds = [...patch.classIds].sort(naturalCompare);
  if ("label" in patch) {
    const typed = String(patch.label).trim();
    if (typed) {
      next.label = typed;
      next.manualLabel = true;
    } else {
      delete next.manualLabel;
    }
  }
  const groups = data.groups.map((g) => (g.id === groupId ? next : g));
  // Trim to the new seat count, keeping locked seats first: a lock is the
  // HOD's "never change this", so an unlocked teacher goes before a locked one.
  const all = seatsOf(data, groupId);
  const keep = new Set(
    [...all]
      .sort((x, y) => Number(Boolean(y.locked)) - Number(Boolean(x.locked)))
      .slice(0, next.teachersNeeded),
  );
  const seats = all.filter((a) => keep.has(a));
  const removed = all.filter((a) => !keep.has(a));
  const others = (data.assignments || []).filter((a) => a.groupId !== groupId);
  const result = ok(withGroups(data, groups, [...others, ...seats]));
  if (removed.length > 0) {
    const who = removed
      .map((a) => findTeacher(data, a.teacherId)?.name || a.teacherId)
      .join(", ");
    result.notice = `Removed ${who} from ${displayName(data, group)} because it now needs ${next.teachersNeeded} teacher(s).`;
  }
  return result;
}

function clearGroupSeats(data, groupId) {
  if (!findGroup(data, groupId))
    return fail(data, "That group no longer exists.");
  return ok({
    ...data,
    assignments: (data.assignments || []).filter((a) => a.groupId !== groupId),
  });
}

// ---------------------------------------------------------------------------
// Seat operations
// ---------------------------------------------------------------------------

/** Replace one group's assignments, keeping every other group's untouched. */
function withGroupSeats(data, groupId, seats) {
  const others = (data.assignments || []).filter((a) => a.groupId !== groupId);
  return { ...data, assignments: [...others, ...seats] };
}

/** teacherId "" clears the seat. Going over cap is allowed; the tally flags it. */
function assignSeat(data, groupId, seatIndex, teacherId) {
  const group = findGroup(data, groupId);
  if (!group) return fail(data, "That group no longer exists.");
  const seats = seatsOf(data, groupId);
  if (!teacherId) {
    if (!seats[seatIndex]) return ok(data);
    return ok(
      withGroupSeats(
        data,
        groupId,
        seats.filter((_, i) => i !== seatIndex),
      ),
    );
  }
  const teacher = findTeacher(data, teacherId);
  if (!teacher) return fail(data, "That teacher no longer exists.");
  const name = displayName(data, group);
  if (!isQualified(teacher, group)) {
    return fail(
      data,
      `${teacher.name} isn't qualified for ${name}. Tick that subject for them on the Teachers tab, or pick someone else.`,
    );
  }
  if (seatIndex >= group.teachersNeeded) {
    return fail(
      data,
      `${name} has only ${group.teachersNeeded} seat(s). Raise "Teachers needed" in the group's details first.`,
    );
  }
  if (seats.some((a, i) => a.teacherId === teacherId && i !== seatIndex)) {
    return fail(data, `${teacher.name} is already teaching ${name}.`);
  }
  const next = [...seats];
  next[seatIndex] = { teacherId, groupId, locked: false };
  return ok(withGroupSeats(data, groupId, next.filter(Boolean)));
}

/** Drag a seat onto a teacher in the tally. */
function assignToTeacher(data, from, teacherId) {
  const seat = seatsOf(data, from.groupId)[from.seatIndex];
  if (!seat) return fail(data, "Nothing to move there.");
  if (seat.locked)
    return fail(data, "That seat is locked. Untick its lock first.");
  return assignSeat(data, from.groupId, from.seatIndex, teacherId);
}

/** Move into an empty seat, or swap with a filled one. Both end up unlocked. */
function dropSeat(data, from, to) {
  const fromSeat = seatsOf(data, from.groupId)[from.seatIndex];
  if (!fromSeat) return fail(data, "Nothing to move there.");
  if (from.groupId === to.groupId) return ok(data);
  const toGroup = findGroup(data, to.groupId);
  const fromGroup = findGroup(data, from.groupId);
  if (!toGroup || !fromGroup) return fail(data, "That group no longer exists.");
  const toSeat = seatsOf(data, to.groupId)[to.seatIndex];
  if (fromSeat.locked || (toSeat && toSeat.locked)) {
    return fail(data, "That seat is locked. Untick its lock first.");
  }
  const mover = findTeacher(data, fromSeat.teacherId);
  if (mover && !isQualified(mover, toGroup)) {
    return fail(
      data,
      `${mover.name} isn't qualified for ${displayName(data, toGroup)}.`,
    );
  }
  if (
    seatsOf(data, to.groupId).some(
      (a) => a !== toSeat && a.teacherId === fromSeat.teacherId,
    )
  ) {
    return fail(
      data,
      `${mover ? mover.name : "That teacher"} is already teaching ${displayName(data, toGroup)}.`,
    );
  }
  if (toSeat) {
    const other = findTeacher(data, toSeat.teacherId);
    if (other && !isQualified(other, fromGroup)) {
      return fail(
        data,
        `${other.name} isn't qualified for ${displayName(data, fromGroup)}.`,
      );
    }
    if (
      seatsOf(data, from.groupId).some(
        (a) => a !== fromSeat && a.teacherId === toSeat.teacherId,
      )
    ) {
      return fail(
        data,
        `${other ? other.name : "That teacher"} is already teaching ${displayName(data, fromGroup)}.`,
      );
    }
    return ok({
      ...data,
      assignments: data.assignments.map((a) =>
        a === fromSeat
          ? { ...a, teacherId: toSeat.teacherId, locked: false }
          : a === toSeat
            ? { ...a, teacherId: fromSeat.teacherId, locked: false }
            : a,
      ),
    });
  }
  if (seatsOf(data, to.groupId).length >= toGroup.teachersNeeded) {
    return fail(data, `${displayName(data, toGroup)} has no free seat.`);
  }
  return ok({
    ...data,
    assignments: [
      ...data.assignments.filter((a) => a !== fromSeat),
      { teacherId: fromSeat.teacherId, groupId: to.groupId, locked: false },
    ],
  });
}

function toggleLock(data, groupId, seatIndex) {
  const seat = seatsOf(data, groupId)[seatIndex];
  if (!seat) return fail(data, "Nothing to lock there. Pick a teacher first.");
  return ok({
    ...data,
    assignments: data.assignments.map((a) =>
      a === seat ? { ...a, locked: !a.locked } : a,
    ),
  });
}

/**
 * Throw away the board's groups and regenerate them from Subjects/Classes/
 * Bands. Groups whose label the HOD typed (custom groups, label overrides)
 * keep it.
 * @returns {{data:any, droppedCount:number}}
 */
function rebuildFromSetup(data) {
  const { data: rebuilt, droppedCount } = rebuildGroups(data);
  const groups = markTypedLabels(data, rebuilt.groups);
  return {
    data: { ...rebuilt, groupsFrozen: true, groups: relabel(groups) },
    droppedCount,
  };
}

// ---------------------------------------------------------------------------
// Read-model: the live teacher tally
// ---------------------------------------------------------------------------

/** @param {any} data */
function buildTally(data) {
  const teacherById = new Map((data?.teachers || []).map((t) => [t.id, t]));
  const rows = buildTeacherView(data).map((r) => {
    const t = teacherById.get(r.teacherId) || {};
    const classes = r.groups.length;
    const warnings = [];
    if (!r.isPlaceholder) {
      if (r.overCap) warnings.push(`Over cap by ${r.load - r.cap} period(s)`);
      if (isSet(t.bigCount) && r.big !== t.bigCount)
        warnings.push(`Wants ${t.bigCount} big (has ${r.big})`);
      if (isSet(t.smallCount) && r.small !== t.smallCount)
        warnings.push(`Wants ${t.smallCount} small (has ${r.small})`);
      if (isSet(t.maxGroups) && classes > t.maxGroups)
        warnings.push(`Max ${t.maxGroups} classes (has ${classes})`);
    }
    let statusKind = "ok";
    let statusText = r.cap > 0 ? `Room for ${r.cap - r.load}p` : "No cap set";
    if (r.isPlaceholder) {
      statusKind = "placeholder";
      statusText = "Placeholder";
    } else if (r.overCap) {
      statusKind = "over";
      statusText = warnings[0];
    } else if (warnings.length > 0) {
      statusKind = "warn";
      statusText = warnings[0];
    } else if (r.cap > 0 && r.load === r.cap) {
      statusText = "At cap";
    }
    return {
      teacherId: r.teacherId,
      name: r.name,
      roleName: r.roleName,
      isPlaceholder: r.isPlaceholder,
      cap: r.cap,
      load: r.load,
      pct: r.cap > 0 ? Math.round((r.load / r.cap) * 100) : 0,
      big: r.big,
      small: r.small,
      classes,
      preps: r.preps,
      statusKind,
      statusText,
      warnings,
      groups: r.groups,
    };
  });

  const summary = buildSummary(data);
  const real = rows.filter((r) => !r.isPlaceholder && r.cap > 0);
  const pcts = real.map((r) => r.pct);
  const demand = (data?.groups || []).reduce(
    (sum, g) => sum + g.periods * g.teachersNeeded,
    0,
  );
  return {
    rows,
    totals: {
      demand,
      capacity: real.reduce((sum, r) => sum + r.cap, 0),
      groupCount: summary.totalGroups,
      groupsFilled: summary.groupsFilled,
      seatsTotal: summary.seatsTotal,
      seatsFilled: summary.seatsFilled,
      unfilledSeats: summary.seatsTotal - summary.seatsFilled,
      placeholderSeats: summary.placeholderSeats,
      spreadPct: pcts.length > 0 ? Math.max(...pcts) - Math.min(...pcts) : 0,
      teachersOverCap: summary.teachersOverCap,
      teachersNeedingCap: summary.teachersUnderRole,
    },
  };
}

export {
  groupLabel,
  autoLabels,
  relabel,
  isQualified,
  buildBoard,
  buildTally,
  addGroup,
  deleteGroup,
  duplicateGroup,
  splitGroup,
  combineGroups,
  updateGroup,
  clearGroupSeats,
  rebuildFromSetup,
  assignSeat,
  assignToTeacher,
  dropSeat,
  toggleLock,
};
