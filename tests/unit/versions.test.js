import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { addDoc, collection, getDocs, doc, getDoc } from "firebase/firestore";
import {
  saveVersion,
  listVersions,
  restoreVersion,
  deleteVersion,
  compareAssignments,
} from "../../src/versions.js";

const ALLOWED_EMAILS = ["hod@example.com", "cohod@example.com"];

let testEnv;
let db;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-my-deployment-buddy",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8081,
    },
  });
  const ctx = testEnv.authenticatedContext("test-uid", {
    email: ALLOWED_EMAILS[0],
  });
  db = ctx.firestore();
});

test.after(async () => {
  await testEnv.cleanup();
});

function fullData(overrides = {}) {
  return {
    roles: [{ id: "r1", name: "Teacher", maxPeriods: 60 }],
    subjects: [{ id: "chem", name: "Chem" }],
    classes: [{ id: "301", level: 3, name: "Respect", subjectIds: ["chem"] }],
    bands: [{ id: "b1", name: "Band 1", classIds: ["301"], subjects: [] }],
    teachers: [{ id: "t1", name: "Amy", roleId: "r1", capOverride: 40 }],
    groups: [{ id: "g1", label: "Group 1", periods: 6 }],
    groupOverrides: { g1: { periods: 8 } },
    customGroups: [{ id: "cg1", label: "Custom" }],
    assignments: [{ groupId: "g1", teacherId: "t1", locked: false }],
    layerSettings: [{ id: "balance", enabled: true, weight: 1 }],
    ...overrides,
  };
}

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

test("saveVersion() then listVersions() returns it with the right changedCount and scope", async () => {
  const id = await saveVersion(db, "v1", fullData(), "2026-01-01T00:00:00Z");
  const versions = await listVersions(db, []); // current has no assignments -> 1 group differs
  const found = versions.find((v) => v.id === id);
  assert.ok(found);
  assert.equal(found.name, "v1");
  assert.equal(found.changedCount, 1);
  assert.equal(found.scope, "full");
});

test("listVersions() sorts newest first", async () => {
  await saveVersion(db, "older", fullData(), "2020-01-01T00:00:00Z");
  await saveVersion(db, "newer", fullData(), "2030-01-01T00:00:00Z");
  const versions = await listVersions(db, []);
  const idxOlder = versions.findIndex((v) => v.name === "older");
  const idxNewer = versions.findIndex((v) => v.name === "newer");
  assert.ok(idxNewer < idxOlder);
});

test("restoreVersion() brings back the whole setup, not just assignments", async () => {
  const saved = fullData();
  const id = await saveVersion(db, "whole-setup", saved);

  // Everything has since been edited/deleted.
  const changed = fullData({
    roles: [],
    subjects: [],
    classes: [],
    bands: [],
    teachers: [{ id: "t9", name: "Someone else" }],
    groups: [],
    groupOverrides: {},
    customGroups: [],
    assignments: [],
    layerSettings: [],
  });
  const restored = await restoreVersion(db, changed, id);
  for (const field of SETUP_FIELDS) {
    assert.deepEqual(restored[field], saved[field], `${field} not restored`);
  }
  assert.deepEqual(restored.assignments, saved.assignments);
  assert.deepEqual(restored.layerSettings, saved.layerSettings);
});

test("restoreVersion() returns a copy, not the stored/live objects", async () => {
  const id = await saveVersion(db, "copy-check", fullData());
  const a = await restoreVersion(db, fullData(), id);
  a.teachers[0].name = "mutated";
  const b = await restoreVersion(db, fullData(), id);
  assert.equal(b.teachers[0].name, "Amy");
});

test("restoreVersion() on an old assignments-only version leaves the current setup untouched", async () => {
  // Shape written by the app before full-setup versions existed.
  const ref = await addDoc(collection(db, "deployments", "main", "versions"), {
    name: "legacy",
    timestamp: "2025-01-01T00:00:00Z",
    assignments: [{ groupId: "g2", teacherId: "t2", locked: true }],
    layerSettings: [{ id: "coverage", enabled: true, weight: 1 }],
  });
  const data = fullData();
  const restored = await restoreVersion(db, data, ref.id);
  assert.deepEqual(restored.assignments, [
    { groupId: "g2", teacherId: "t2", locked: true },
  ]);
  assert.deepEqual(restored.layerSettings, [
    { id: "coverage", enabled: true, weight: 1 },
  ]);
  for (const field of SETUP_FIELDS) {
    assert.deepEqual(
      restored[field],
      data[field],
      `${field} should be untouched`,
    );
  }
  const listed = (await listVersions(db, [])).find((v) => v.id === ref.id);
  assert.equal(listed.scope, "assignments");
});

test("restoreVersion() throws for an unknown id", async () => {
  await assert.rejects(() => restoreVersion(db, fullData(), "does-not-exist"));
});

test("deleteVersion() removes only that version", async () => {
  const keep = await saveVersion(db, "keep-me", fullData());
  const drop = await saveVersion(db, "drop-me", fullData());
  await deleteVersion(db, drop);
  const ids = (await listVersions(db, [])).map((v) => v.id);
  assert.ok(ids.includes(keep));
  assert.ok(!ids.includes(drop));
  await assert.rejects(() => restoreVersion(db, fullData(), drop));
});

test("deleteVersion() on an unknown id does not throw or affect others", async () => {
  const keep = await saveVersion(db, "still-here", fullData());
  await deleteVersion(db, "does-not-exist");
  const ids = (await listVersions(db, [])).map((v) => v.id);
  assert.ok(ids.includes(keep));
});

test("compareAssignments() finds no changes when nothing changed", () => {
  const a = [{ teacherId: "t1", groupId: "g1", locked: false }];
  const b = [{ teacherId: "t1", groupId: "g1", locked: true }]; // lock flag differs but teacher assignment doesn't
  assert.deepEqual(compareAssignments(a, b), []);
});

test("compareAssignments() reports a group whose teacher changed", () => {
  const a = [{ teacherId: "t1", groupId: "g1", locked: false }];
  const b = [{ teacherId: "t2", groupId: "g1", locked: false }];
  assert.deepEqual(compareAssignments(a, b), [
    { groupId: "g1", from: ["t1"], to: ["t2"] },
  ]);
});

test("compareAssignments() reports a group that gained or lost a co-teacher", () => {
  const a = [{ teacherId: "t1", groupId: "g1", locked: false }];
  const b = [
    { teacherId: "t1", groupId: "g1", locked: false },
    { teacherId: "t2", groupId: "g1", locked: false },
  ];
  const changes = compareAssignments(a, b);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].from, ["t1"]);
  assert.deepEqual(changes[0].to, ["t1", "t2"]);
});

test("compareAssignments() reports a group that newly appears or disappears", () => {
  const a = [];
  const b = [{ teacherId: "t1", groupId: "g1", locked: false }];
  assert.deepEqual(compareAssignments(a, b), [
    { groupId: "g1", from: [], to: ["t1"] },
  ]);
  assert.deepEqual(compareAssignments(b, a), [
    { groupId: "g1", from: ["t1"], to: [] },
  ]);
});

test("a full snapshot restores groupsFrozen and the big/small threshold", async () => {
  const data = fullData({ groupsFrozen: true, settings: { bigPeriods: 8 } });
  const id = await saveVersion(db, "frozen", data, "2026-02-01T00:00:00Z");
  const restored = await restoreVersion(db, fullData(), id);
  assert.equal(restored.groupsFrozen, true);
  assert.deepEqual(restored.settings, { bigPeriods: 8 });
});

test("restoring a full version saved before the Board existed un-freezes the groups so typed names are protected again", async () => {
  const old = fullData(); // no groupsFrozen, no settings
  const id = await saveVersion(db, "pre-board", old, "2026-03-01T00:00:00Z");
  const restored = await restoreVersion(
    db,
    fullData({ groupsFrozen: true, settings: { bigPeriods: 8 } }),
    id,
  );
  assert.equal("groupsFrozen" in restored, false);
  assert.equal("settings" in restored, false);
});
