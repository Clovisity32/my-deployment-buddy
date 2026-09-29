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

test("saveVersion() then listVersions() returns it with the right changedCount", async () => {
  const assignments = [{ groupId: "g1", teacherId: "t1", locked: false }];
  const id = await saveVersion(
    db,
    "v1",
    assignments,
    [],
    "2026-01-01T00:00:00Z",
  );
  const versions = await listVersions(db, []); // current has no assignments -> 1 group differs
  const found = versions.find((v) => v.id === id);
  assert.ok(found);
  assert.equal(found.name, "v1");
  assert.equal(found.changedCount, 1);
});

test("listVersions() sorts newest first", async () => {
  await saveVersion(db, "older", [], [], "2020-01-01T00:00:00Z");
  await saveVersion(db, "newer", [], [], "2030-01-01T00:00:00Z");
  const versions = await listVersions(db, []);
  const idxOlder = versions.findIndex((v) => v.name === "older");
  const idxNewer = versions.findIndex((v) => v.name === "newer");
  assert.ok(idxNewer < idxOlder);
});

test("restoreVersion() applies the version's assignments/layerSettings onto data, leaving everything else untouched", async () => {
  const id = await saveVersion(
    db,
    "to-restore",
    [{ groupId: "g2", teacherId: "t2", locked: true }],
    [{ id: "coverage", enabled: true, weight: 1 }],
  );
  const data = { teachers: [{ id: "t2" }], assignments: [], layerSettings: [] };
  const restored = await restoreVersion(db, data, id);
  assert.deepEqual(restored.assignments, [
    { groupId: "g2", teacherId: "t2", locked: true },
  ]);
  assert.deepEqual(restored.layerSettings, [
    { id: "coverage", enabled: true, weight: 1 },
  ]);
  assert.deepEqual(restored.teachers, data.teachers); // untouched
});

test("restoreVersion() throws for an unknown id", async () => {
  const data = { assignments: [], layerSettings: [] };
  await assert.rejects(() => restoreVersion(db, data, "does-not-exist"));
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
