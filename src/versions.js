// Deployment memory: named snapshots the HOD can save, list, restore, and
// compare. Versions live in Firestore's deployments/main/versions
// subcollection (not embedded in the main document) so the main document
// never grows unbounded - see
// docs/superpowers/specs/2026-09-29-firestore-sync-design.md.
//
// compareAssignments() is unchanged from before this file's Firestore
// rewrite: pure, synchronous, no storage dependency.

import { collection, addDoc, getDocs, doc, getDoc } from "firebase/firestore";

function versionsCollection(db) {
  return collection(db, "deployments", "main", "versions");
}

/**
 * @param {any} db Firestore instance (store.js's getFirestoreDb())
 * @param {string} name
 * @param {{groupId:string, teacherId:string, locked:boolean}[]} assignments
 * @param {{id:string, enabled:boolean, weight:number}[]} layerSettings
 * @param {string} [timestamp] ISO string; defaults to now. Passed explicitly in tests for determinism.
 * @returns {Promise<string>} the new version's Firestore document id
 */
async function saveVersion(
  db,
  name,
  assignments,
  layerSettings,
  timestamp = new Date().toISOString(),
) {
  const ref = await addDoc(versionsCollection(db), {
    name,
    timestamp,
    assignments: deepCopy(assignments),
    layerSettings: deepCopy(layerSettings),
  });
  return ref.id;
}

/**
 * @param {any} db
 * @param {{groupId:string, teacherId:string, locked:boolean}[]} currentAssignments
 * @returns {Promise<{id:string, name:string, timestamp:string, changedCount:number}[]>} newest first
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
