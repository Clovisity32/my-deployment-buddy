// Builds the Deployment View layout: groups organised by level, then by
// subject block (mirroring "Current Deployment Layout.png" - Sec 1..5 rows,
// Chem/Phy/Bio side-by-side blocks). Pure function: data -> layout. The
// actual HTML rendering (colours, click-to-reassign, lock toggle) lives in
// ui.js; keeping this pure makes the layout logic unit-testable without a
// DOM.
//
// Also builds the "summary strip" (buildSummary) and "By Teacher" view
// (buildTeacherView) that ui.js renders alongside the deployment layout.
// Both are pure and dependency-free of setup.js (a peer pure module) except
// for effectiveCap(), which is the single source of truth for a teacher's
// load cap.

import { effectiveCap, bigThreshold } from "./data.js";

const CANONICAL_BLOCK_ORDER = ["LSS", "Chem", "Phy", "Bio"];

function blockSortKey(block) {
  const i = CANONICAL_BLOCK_ORDER.indexOf(block);
  return i === -1 ? CANONICAL_BLOCK_ORDER.length : i;
}

/**
 * @param {import('./data.js').default} data
 * @returns {{level:number, blocks:{block:string, rows:DeploymentRow[]}[]}[]}
 */
/** @typedef {{
 *   groupId:string, label:string, category:string, note:string,
 *   teachersNeeded:number, teacherNames:string[],
 *   complete:boolean, hasPlaceholder:boolean, anyLocked:boolean,
 * }} DeploymentRow
 */
function buildDeploymentView(data) {
  const teacherById = new Map(data.teachers.map((t) => [t.id, t]));
  const assignmentsByGroup = new Map();
  for (const a of data.assignments || []) {
    if (!assignmentsByGroup.has(a.groupId))
      assignmentsByGroup.set(a.groupId, []);
    assignmentsByGroup.get(a.groupId).push(a);
  }

  const levels = [...new Set(data.groups.map((g) => g.level))].sort(
    (a, b) => a - b,
  );

  return levels.map((level) => {
    const groupsAtLevel = data.groups.filter((g) => g.level === level);
    const blocksPresent = [...new Set(groupsAtLevel.map((g) => g.block))].sort(
      (a, b) => blockSortKey(a) - blockSortKey(b) || a.localeCompare(b),
    );

    return {
      level,
      blocks: blocksPresent.map((block) => ({
        block,
        rows: groupsAtLevel
          .filter((g) => g.block === block)
          .map((g) =>
            buildRow(g, assignmentsByGroup.get(g.id) || [], teacherById),
          ),
      })),
    };
  });
}

/** @returns {DeploymentRow} */
function buildRow(group, assignments, teacherById) {
  const teacherNames = assignments.map(
    (a) => teacherById.get(a.teacherId)?.name || a.teacherId,
  );
  return {
    groupId: group.id,
    label: group.label,
    category: group.category || "",
    note: group.note || "",
    teachersNeeded: group.teachersNeeded,
    teacherNames,
    complete: assignments.length >= group.teachersNeeded,
    hasPlaceholder: assignments.some(
      (a) => teacherById.get(a.teacherId)?.isPlaceholder,
    ),
    anyLocked: assignments.some((a) => a.locked),
  };
}

/**
 * Whole-deployment summary shown in a "summary strip" above the deployment
 * view. Pure, defensive: never throws, returns sensible zeros for empty
 * data.
 * @param {any} data
 * @returns {{
 *   totalGroups:number, groupsFilled:number, groupsIncomplete:number,
 *   seatsTotal:number, seatsFilled:number, placeholderSeats:number,
 *   teachersOverCap:{teacherId:string, name:string, load:number, cap:number}[],
 *   teachersUnderRole:{teacherId:string, name:string}[],
 * }}
 */
function buildSummary(data) {
  const teachers = Array.isArray(data?.teachers) ? data.teachers : [];
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
  const roles = Array.isArray(data?.roles) ? data.roles : [];

  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupIds = new Set(groups.map((g) => g.id));

  const assignmentsByGroup = new Map();
  const assignmentsByTeacher = new Map();
  for (const a of assignments) {
    if (!assignmentsByGroup.has(a.groupId))
      assignmentsByGroup.set(a.groupId, []);
    assignmentsByGroup.get(a.groupId).push(a);
    if (!assignmentsByTeacher.has(a.teacherId))
      assignmentsByTeacher.set(a.teacherId, []);
    assignmentsByTeacher.get(a.teacherId).push(a);
  }

  const totalGroups = groups.length;
  const groupsFilled = groups.filter(
    (g) => (assignmentsByGroup.get(g.id) || []).length >= g.teachersNeeded,
  ).length;
  const groupsIncomplete = totalGroups - groupsFilled;
  const seatsTotal = groups.reduce((sum, g) => sum + g.teachersNeeded, 0);
  const seatsFilled = assignments.filter((a) => groupIds.has(a.groupId)).length;
  const placeholderSeats = assignments.filter(
    (a) => teacherById.get(a.teacherId)?.isPlaceholder,
  ).length;

  const teachersOverCap = [];
  const teachersUnderRole = [];
  teachers.forEach((t) => {
    const teacherAssignments = assignmentsByTeacher.get(t.id) || [];
    const load = teacherAssignments.reduce((sum, a) => {
      const g = groupById.get(a.groupId);
      return sum + (g ? g.periods : 0);
    }, 0);
    const cap = effectiveCap(data, t);
    if (load > cap) {
      teachersOverCap.push({ teacherId: t.id, name: t.name, load, cap });
    }

    const role = roleById.get(t.roleId);
    if (
      role &&
      role.maxPeriods === null &&
      (t.capOverride === null || typeof t.capOverride === "undefined")
    ) {
      teachersUnderRole.push({ teacherId: t.id, name: t.name });
    }
  });

  return {
    totalGroups,
    groupsFilled,
    groupsIncomplete,
    seatsTotal,
    seatsFilled,
    placeholderSeats,
    teachersOverCap,
    teachersUnderRole,
  };
}

/**
 * One row per teacher for the "By Teacher" view, sorted by role name then
 * teacher name. Pure, defensive: never throws.
 * @param {any} data
 * @returns {{
 *   teacherId:string, name:string, roleName:string, cap:number, load:number,
 *   isPlaceholder:boolean, overCap:boolean,
 *   big:number, small:number, preps:number, // group counts; big = bigThreshold(data)+ periods; preps = distinct subjects
 *   groups:{groupId:string, label:string, periods:number, locked:boolean}[],
 * }[]}
 */
function buildTeacherView(data) {
  const teachers = Array.isArray(data?.teachers) ? data.teachers : [];
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
  const roles = Array.isArray(data?.roles) ? data.roles : [];

  const roleById = new Map(roles.map((r) => [r.id, r]));
  const threshold = bigThreshold(data);

  const rows = teachers.map((t) => {
    const role = roleById.get(t.roleId);
    const roleName = role ? role.name : "";
    const cap = effectiveCap(data, t);
    const teacherAssignments = assignments.filter((a) => a.teacherId === t.id);
    const teacherGroups = groups
      .filter((g) => teacherAssignments.some((a) => a.groupId === g.id))
      .map((g) => {
        const a = teacherAssignments.find((a2) => a2.groupId === g.id);
        return {
          groupId: g.id,
          label: g.label,
          periods: g.periods,
          locked: !!a?.locked,
          subject: g.subjectId || g.block,
        };
      });
    const load = teacherGroups.reduce((sum, g) => sum + g.periods, 0);
    const big = teacherGroups.filter((g) => g.periods >= threshold).length;
    const preps = new Set(teacherGroups.map((g) => g.subject)).size;

    return {
      teacherId: t.id,
      name: t.name,
      roleName,
      cap,
      load,
      isPlaceholder: !!t.isPlaceholder,
      overCap: load > cap,
      big,
      small: teacherGroups.length - big,
      preps,
      groups: teacherGroups,
    };
  });

  return rows.sort(
    (a, b) =>
      a.roleName.localeCompare(b.roleName) || a.name.localeCompare(b.name),
  );
}

/**
 * True unless the Load cap layer has been unticked in the Layers tab
 * (mirrors model.js: an unconfigured layer defaults to enabled).
 * @param {any} data
 */
function isLoadCapEnabled(data) {
  const setting = (
    Array.isArray(data?.layerSettings) ? data.layerSettings : []
  ).find((s) => s && s.id === "loadCap");
  return setting ? setting.enabled !== false : true;
}

/** Total periods currently assigned to a teacher. */
function teacherLoad(data, teacherId) {
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  return (Array.isArray(data?.assignments) ? data.assignments : [])
    .filter((a) => a.teacherId === teacherId)
    .reduce((sum, a) => {
      const g = groups.find((x) => x.id === a.groupId);
      return sum + (g ? g.periods : 0);
    }, 0);
}

/**
 * Would giving `teacherId` the group `groupId` push them past their cap?
 * Placeholder teachers are never flagged (they stand in for a hiring gap).
 * A teacher already on the group is not double-counted.
 * @param {any} data
 * @param {string} teacherId
 * @param {string} groupId
 * @returns {{exceeds:boolean, load:number, newLoad:number, cap:number}}
 */
function wouldExceedCap(data, teacherId, groupId) {
  const teacher = (data?.teachers || []).find((t) => t.id === teacherId);
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
  const group = groups.find((g) => g.id === groupId);
  if (!teacher || !group)
    return { exceeds: false, load: 0, newLoad: 0, cap: 0 };

  const cap = effectiveCap(data, teacher);
  const load = teacherLoad(data, teacherId);
  const alreadyOnGroup = assignments.some(
    (a) => a.teacherId === teacherId && a.groupId === groupId,
  );
  const newLoad = alreadyOnGroup ? load : load + group.periods;
  return {
    exceeds: !teacher.isPlaceholder && newLoad > cap,
    load,
    newLoad,
    cap,
  };
}

export {
  blockSortKey,
  buildDeploymentView,
  buildSummary,
  buildTeacherView,
  isLoadCapEnabled,
  teacherLoad,
  wouldExceedCap,
};
