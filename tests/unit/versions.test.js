import { test } from "node:test";
import assert from "node:assert/strict";
import {
  saveVersion,
  listVersions,
  restoreVersion,
  compareAssignments,
} from "../../src/versions.js";

function baseData() {
  return {
    teachers: [{ id: "t1", name: "Amy", maxPeriods: 20, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Chem",
        label: "G1",
        periods: 4,
        band: null,
        teachersNeeded: 1,
      },
    ],
    assignments: [{ teacherId: "t1", groupId: "g1", locked: false }],
    layerSettings: [{ id: "coverage", enabled: true, weight: 1 }],
    versions: [],
  };
}

test("saveVersion() appends a snapshot without mutating the input", () => {
  const data = baseData();
  const originalVersions = data.versions;
  const result = saveVersion(data, "v1", "2026-01-01T00:00:00.000Z");

  assert.equal(
    data.versions,
    originalVersions,
    "input data must not be mutated",
  );
  assert.equal(data.versions.length, 0);
  assert.equal(result.versions.length, 1);
  assert.equal(result.versions[0].name, "v1");
  assert.equal(result.versions[0].timestamp, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(result.versions[0].assignments, data.assignments);
});

test("saveVersion() snapshot is a deep copy - later mutation of data does not affect it", () => {
  const data = baseData();
  const withVersion = saveVersion(data, "v1", "2026-01-01T00:00:00.000Z");
  data.assignments[0].teacherId = "CHANGED";
  assert.equal(withVersion.versions[0].assignments[0].teacherId, "t1");
});

test("listVersions() returns newest first and omits the assignment payload", () => {
  let data = baseData();
  data = saveVersion(data, "first", "2026-01-01T00:00:00.000Z");
  data = saveVersion(data, "second", "2026-02-01T00:00:00.000Z");
  const list = listVersions(data);
  assert.deepEqual(
    list.map((v) => v.name),
    ["second", "first"],
  );
  assert.equal(list[0].assignments, undefined);
});

test("restoreVersion() replaces assignments/layerSettings but keeps teachers/groups/versions", () => {
  let data = baseData();
  data = saveVersion(data, "v1", "2026-01-01T00:00:00.000Z");
  // Simulate editing after the save.
  const edited = {
    ...data,
    assignments: [{ teacherId: "t1", groupId: "g1", locked: true }],
    layerSettings: [{ id: "coverage", enabled: false, weight: 1 }],
  };

  const restored = restoreVersion(edited, 0);
  assert.deepEqual(restored.assignments, [
    { teacherId: "t1", groupId: "g1", locked: false },
  ]);
  assert.deepEqual(restored.layerSettings, [
    { id: "coverage", enabled: true, weight: 1 },
  ]);
  assert.equal(restored.teachers, edited.teachers);
  assert.equal(restored.groups, edited.groups);
  assert.equal(restored.versions, edited.versions);
});

test("restoreVersion() throws a clear error for an out-of-range index", () => {
  const data = baseData();
  assert.throws(() => restoreVersion(data, 5), /No version at index 5/);
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
