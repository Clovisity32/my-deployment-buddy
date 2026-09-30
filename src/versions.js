// Deployment memory: named snapshots the HOD can save, list, restore, and
// compare. Versions live in Firestore's deployments/main/versions
// subcollection (not embedded in the main document) so the main document
// never grows unbounded - see
// docs/superpowers/specs/2026-09-29-firestore-sync-design.md.
//
// compareAssignments() is unchanged from before this file's Firestore
// rewrite: pure, synchronous, no storage dependency.

import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  deleteDoc,
} from "firebase/firestore";

function versionsCollection(db) {
  return collection(db, "deployments", "main", "versions");
}

// Everything that defines "the setup" besides assignments/layerSettings. A
// full-scope version snapshots these too, so restoring brings back the
// teachers, bands and groups as they were - not just who teaches what.
// Versions saved before full snapshots existed only hold assignments and
// layerSettings (scope "assignments"); restoring one leaves the current
// setup untouched.
const SETUP_FIELDS = [
  "roles",
  "subjects",
  "classes",
  "bands",
  "teachers",
  "groups",
  "groupOverrides",
  "customGroups",
];

/**
 * Snapshots the full deployment: setup, assignments and layer settings.
 * @param {any} db Firestore instance (store.js's getFirestoreDb())
 * @param {string} name
 * @param {import('./data.js').default} data the current deployment data
 * @param {string} [timestamp] ISO string; defaults to now. Passed explicitly in tests for determinism.
 * @returns {Promise<string>} the new version's Firestore document id
 */
async function saveVersion(
  db,
  name,
  data,
  timestamp = new Date().toISOString(),
) {
  const snapshot = {
    name,
    timestamp,
    scope: "full",
    assignments: deepCopy(data.assignments || []),
    layerSettings: deepCopy(data.layerSettings || []),
  };
  for (const field of SETUP_FIELDS) {
    if (data[field] !== undefined) snapshot[field] = deepCopy(data[field]);
  }
  const ref = await addDoc(versionsCollection(db), snapshot);
  return ref.id;
}

/**
 * Permanently deletes one saved version. Deleting an id that doesn't exist
 * is a no-op (Firestore's deleteDoc doesn't fail on a missing document).
 * @param {any} db
 * @param {string} versionId
 * @returns {Promise<void>}
 */
async function deleteVersion(db, versionId) {
  await deleteDoc(doc(db, "deployments", "main", "versions", versionId));
}

/**
 * @param {any} db
 * @param {{groupId:string, teacherId:string, locked:boolean}[]} currentAssignments
 * @returns {Promise<{id:string, name:string, timestamp:string, changedCount:number, scope:"full"|"assignments"}[]>} newest first
 */
async function listVersions(db, currentAssignments) {
  const snap = await getDocs(versionsCollection(db));
  return snap.docs
    .map((d) => {
      const v = d.data();
      return {
        id: d.id,
        name: v.name,
        timestamp: v.timestamp,
        scope: v.scope === "full" ? "full" : "assignments",
        changedCount: compareAssignments(v.assignments, currentAssignments)
          .length,
      };
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * @param {any} db
 * @param {import('./data.js').default} data
 * @param {string} versionId
 * @returns {Promise<import('./data.js').default>} a new data object
 * @throws {Error} if no version with that id exists
 */
async function restoreVersion(db, data, versionId) {
  const snap = await getDoc(
    doc(db, "deployments", "main", "versions", versionId),
  );
  if (!snap.exists()) {
    throw new Error(`No version with id ${versionId}`);
  }
  const version = snap.data();
  const restored = {
    ...data,
    assignments: deepCopy(version.assignments),
    layerSettings: deepCopy(version.layerSettings),
  };
  if (version.scope === "full") {
    for (const field of SETUP_FIELDS) {
      if (version[field] !== undefined)
        restored[field] = deepCopy(version[field]);
    }
  }
  return restored;
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

export {
  saveVersion,
  listVersions,
  restoreVersion,
  deleteVersion,
  compareAssignments,
};
