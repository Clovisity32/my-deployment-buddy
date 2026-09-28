// Deployment memory: named snapshots the HOD can save, list, restore, and
// compare. Every function here is pure - it takes a data object and returns
// a NEW data object, never mutating its input - so the UI layer can hold
// onto the previous value for an "undo" without any extra bookkeeping.
//
// Nothing here calls the solver. Restoring a version is just copying its
// saved assignments back onto the current data - re-opening a deployment
// must never trigger a fresh solve (see CLAUDE.md).

/**
 * @param {import('./data.js').default} data
 * @param {string} name
 * @param {string} [timestamp] ISO string; defaults to now. Passed explicitly in tests for determinism.
 * @returns {import('./data.js').default} a new data object with the snapshot appended
 */
function saveVersion(data, name, timestamp = new Date().toISOString()) {
  const snapshot = {
    name,
    timestamp,
    assignments: deepCopy(data.assignments || []),
    layerSettings: deepCopy(data.layerSettings || []),
  };
  return {
    ...data,
    versions: [...(data.versions || []), snapshot],
  };
}

/**
 * @param {import('./data.js').default} data
 * @returns {{name:string, timestamp:string}[]} newest first, without the (possibly large) assignment payload
 */
function listVersions(data) {
  return [...(data.versions || [])]
    .map((v) => ({ name: v.name, timestamp: v.timestamp }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Restores a saved version's assignments and layer settings onto `data`.
 * Teachers, groups, and the version history itself are left untouched.
 * @param {import('./data.js').default} data
 * @param {number} versionIndex index into data.versions (its original save order, not the sorted listVersions() order)
 * @returns {import('./data.js').default} a new data object
 * @throws {Error} if versionIndex is out of range
 */
function restoreVersion(data, versionIndex) {
  const version = (data.versions || [])[versionIndex];
  if (!version) {
    throw new Error(`No version at index ${versionIndex}`);
  }
  return {
    ...data,
    assignments: deepCopy(version.assignments),
    layerSettings: deepCopy(version.layerSettings),
  };
}

/**
 * Compares two versions (or a version and the current deployment) and
 * returns only the groups whose assigned teacher(s) changed.
 * @param {{groupId:string, teacherId:string, locked:boolean}[]} fromAssignments
 * @param {{groupId:string, teacherId:string, locked:boolean}[]} toAssignments
 * @returns {{groupId:string, from:string[], to:string[]}[]} sorted by groupId
 */
function compareAssignments(fromAssignments, toAssignments) {
  const fromByGroup = groupByGroupId(fromAssignments);
  const toByGroup = groupByGroupId(toAssignments);
  const allGroupIds = new Set([...fromByGroup.keys(), ...toByGroup.keys()]);

  const changes = [];
  for (const groupId of allGroupIds) {
    const from = (fromByGroup.get(groupId) || []).sort();
    const to = (toByGroup.get(groupId) || []).sort();
    if (from.length !== to.length || from.some((t, i) => t !== to[i])) {
      changes.push({ groupId, from, to });
    }
  }
  return changes.sort((a, b) => a.groupId.localeCompare(b.groupId));
}

function groupByGroupId(assignments) {
  const map = new Map();
  for (const a of assignments) {
    if (!map.has(a.groupId)) map.set(a.groupId, []);
    map.get(a.groupId).push(a.teacherId);
  }
  return map;
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

export { saveVersion, listVersions, restoreVersion, compareAssignments };
