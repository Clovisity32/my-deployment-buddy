// Builds the Deployment View layout: groups organised by level, then by
// subject block (mirroring "Current Deployment Layout.png" - Sec 1..5 rows,
// Chem/Phy/Bio side-by-side blocks). Pure function: data -> layout. The
// actual HTML rendering (colours, click-to-reassign, lock toggle) lives in
// ui.js; keeping this pure makes the layout logic unit-testable without a
// DOM.

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

export { buildDeploymentView };
