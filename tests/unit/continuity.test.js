import { test } from "node:test";
import assert from "node:assert/strict";
import { applyContinuity } from "../../src/continuity.js";

const school = () => ({
  roles: [{ id: "r", name: "R", maxPeriods: 100 }],
  classes: [
    { id: "101", level: 1, name: "Curiosity" },
    { id: "201", level: 2, name: "Curiosity" },
    { id: "202", level: 2, name: "Respect" },
    { id: "301", level: 3, name: "Curiosity" },
    { id: "401", level: 4, name: "Curiosity" },
    { id: "501", level: 5, name: "Flourish" },
  ],
  teachers: [
    { id: "t1", name: "Amy Lim", roleId: "r", qualifications: ["LSS", "CHEM"] },
    { id: "t2", name: "Ben Ong", roleId: "r", qualifications: ["LSS"] },
    {
      id: "t3",
      name: "Cat Wee",
      roleId: "r",
      qualifications: ["CHEM"],
      denies: [{ level: 4 }],
    },
  ],
  groups: [
    {
      id: "g201",
      level: 2,
      subjectId: "LSS",
      stream: "G1",
      classIds: ["201", "202"],
      teachersNeeded: 1,
      periods: 6,
      block: "LSS",
      label: "g201",
    },
    {
      id: "g401",
      level: 4,
      subjectId: "CHEM",
      stream: "G3",
      classIds: ["401"],
      teachersNeeded: 1,
      periods: 6,
      block: "CHEM",
      label: "g401",
    },
  ],
  assignments: [],
  lastYear: [],
});
const ly = (level, classRef, subjectId, teacherId) => ({
  level,
  classRef,
  subjectId,
  teacherId,
});

test("Sec 1 -> 2 and Sec 3 -> 4 become locked assignments", () => {
  const d = school();
  d.lastYear = [ly(1, "101", "LSS", "t2"), ly(3, "301", "CHEM", "t1")];
  const r = applyContinuity(d);
  assert.equal(r.added, 2);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.data.assignments, [
    { teacherId: "t2", groupId: "g201", locked: true },
    { teacherId: "t1", groupId: "g401", locked: true },
  ]);
  assert.equal(d.assignments.length, 0); // input untouched
});

test("a class can be given by name when its id doesn't follow level+suffix", () => {
  const d = school();
  d.lastYear = [ly(1, "Respect", "LSS", "t1")]; // Sec 2 Respect = 202, in g201
  assert.equal(applyContinuity(d).added, 1);
});

test("other levels are not locked (Sec 2, Sec 4 and Sec 5 are left to the solver)", () => {
  const d = school();
  d.lastYear = [
    ly(2, "201", "LSS", "t1"),
    ly(4, "401", "CHEM", "t1"),
    ly(5, "501", "CHEM", "t1"),
  ];
  const r = applyContinuity(d);
  assert.equal(r.added, 0);
  assert.equal(r.data, d);
});

test("skips with a reason: unknown class, no such group, unqualified, denied, full", () => {
  const d = school();
  d.assignments = [{ teacherId: "t2", groupId: "g201", locked: false }];
  d.lastYear = [
    ly(1, "199", "LSS", "t1"), // no Sec 2 class matches
    ly(1, "101", "CHEM", "t1"), // Sec 2 has no CHEM group for that class
    ly(3, "301", "CHEM", "t2"), // Ben is not qualified for CHEM
    ly(3, "301", "CHEM", "t3"), // Cat is denied Sec 4
    ly(1, "101", "LSS", "t1"), // g201 already has its teacher (Ben)
  ];
  const r = applyContinuity(d);
  assert.equal(r.added, 0);
  assert.equal(r.skipped.length, 5);
  assert.match(r.skipped[0].message, /no Sec 2 class/i);
  assert.match(r.skipped[1].message, /no group/i);
  assert.match(r.skipped[2].message, /not qualified/i);
  assert.match(r.skipped[3].message, /deny list/i);
  assert.match(r.skipped[4].message, /already has all the teachers/i);
  assert.equal(r.skipped[4].message.includes("already applied"), false);
});

test("applying twice never re-locks a seat the HOD unlocked on purpose", () => {
  const d = school();
  d.lastYear = [ly(1, "101", "LSS", "t2")];
  const once = applyContinuity(d);
  const unlocked = {
    ...once.data,
    assignments: once.data.assignments.map((a) => ({ ...a, locked: false })),
  };
  const twice = applyContinuity(unlocked);
  assert.equal(twice.added, 0);
  assert.equal(twice.data.assignments[0].locked, false);
  assert.match(twice.skipped[0].message, /already applied once/i);
});

test("a placed teacher is reported as already placed (and not marked applied)", () => {
  const d = school();
  d.assignments = [{ teacherId: "t2", groupId: "g201", locked: false }];
  d.lastYear = [ly(1, "101", "LSS", "t2")];
  const r = applyContinuity(d);
  assert.match(r.skipped[0].message, /already placed/i);
  assert.equal(r.data, d);
  assert.equal(d.lastYear[0].applied, undefined);
});

test("a seat the HOD cleared after applying is not re-locked", () => {
  const d = school();
  d.lastYear = [ly(1, "101", "LSS", "t2")];
  const once = applyContinuity(d);
  assert.equal(once.added, 1);
  assert.equal(once.data.lastYear[0].applied, true);
  assert.equal(d.lastYear[0].applied, undefined); // input untouched
  const cleared = { ...once.data, assignments: [] };
  const twice = applyContinuity(cleared);
  assert.equal(twice.added, 0);
  assert.equal(twice.data, cleared);
  assert.deepEqual(twice.data.assignments, []);
  assert.match(twice.skipped[0].message, /already applied once/);
  assert.match(twice.skipped[0].message, /place them by hand/);
});

test("rows skipped for other reasons are not marked, so they can be retried", () => {
  const d = school();
  d.lastYear = [ly(1, "199", "LSS", "t1"), ly(1, "101", "LSS", "t2")];
  const r = applyContinuity(d);
  assert.equal(r.added, 1);
  assert.equal(r.data.lastYear[0].applied, undefined);
  assert.equal(r.data.lastYear[1].applied, true);
});

test("a class can be given as '3 Curiosity' / 'Sec 3 Curiosity' (last-year level)", () => {
  const d = school();
  d.lastYear = [
    ly(3, "Sec 3 Curiosity", "CHEM", "t1"),
  ];
  assert.equal(applyContinuity(d).added, 1);
  const d2 = school();
  d2.lastYear = [ly(1, "1 Respect", "LSS", "t1")];
  assert.equal(applyContinuity(d2).added, 1);
  const d3 = school();
  d3.lastYear = [ly(1, "S1-Respect", "LSS", "t1")];
  assert.equal(applyContinuity(d3).added, 1);
});

test("a name matching two target classes is not guessed", () => {
  const d = school();
  d.classes.push({ id: "203", level: 2, name: "Respect" });
  d.lastYear = [ly(1, "Respect", "LSS", "t1")];
  assert.equal(applyContinuity(d).added, 0);
});

test("no last-year data, or missing arrays, is harmless", () => {
  assert.equal(applyContinuity({}).added, 0);
  assert.equal(
    applyContinuity({ lastYear: [ly(1, "101", "LSS", "t1")] }).added,
    0,
  );
});
