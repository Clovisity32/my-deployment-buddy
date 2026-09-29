import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildDeploymentView,
  buildSummary,
  buildTeacherView,
} from "../../src/view.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplePath = path.join(__dirname, "../../sample/sample.json");

// sample/sample.json is schema v2 (roles/subjects/classes/bands/
// qualifications) - load it as-is to exercise buildSummary/buildTeacherView
// against the actual fictional school shape.
function loadSample() {
  return JSON.parse(readFileSync(samplePath, "utf8"));
}

function fixture() {
  return {
    teachers: [
      { id: "t1", name: "Amy", maxPeriods: 20, subjects: ["Chem"] },
      { id: "t2", name: "Ben", maxPeriods: 20, subjects: ["Phy"] },
      {
        id: "t9",
        name: "New Teacher",
        maxPeriods: 20,
        subjects: ["Chem"],
        isPlaceholder: true,
      },
    ],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Chem",
        label: "301 Chem",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        category: "G1",
        note: "Banded with g2",
      },
      {
        id: "g2",
        level: 3,
        block: "Phy",
        label: "301 Phy",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        category: "G1",
        note: "",
      },
      {
        id: "g3",
        level: 3,
        block: "Chem",
        label: "406 EXP Chem",
        periods: 4,
        band: null,
        teachersNeeded: 2,
        category: "EXP",
        note: "Co-taught",
      },
      {
        id: "g4",
        level: 1,
        block: "LSS",
        label: "1G1A SCI",
        periods: 5,
        band: null,
        teachersNeeded: 1,
        category: "G1",
        note: "",
      },
    ],
    assignments: [
      { teacherId: "t1", groupId: "g1", locked: false },
      { teacherId: "t2", groupId: "g2", locked: true },
      { teacherId: "t1", groupId: "g3", locked: false },
      { teacherId: "t9", groupId: "g3", locked: false }, // co-taught, one seat filled by a placeholder
      // g4 (1G1A SCI) is deliberately left unassigned.
    ],
  };
}

test("buildDeploymentView() groups by level (ascending) then by canonical block order", () => {
  const view = buildDeploymentView(fixture());
  assert.deepEqual(
    view.map((l) => l.level),
    [1, 3],
  );
  const level3 = view.find((l) => l.level === 3);
  assert.deepEqual(
    level3.blocks.map((b) => b.block),
    ["Chem", "Phy"],
  ); // Chem before Phy per canonical order
});

test("buildDeploymentView() lists teacher names for an assigned group", () => {
  const view = buildDeploymentView(fixture());
  const level3 = view.find((l) => l.level === 3);
  const chemBlock = level3.blocks.find((b) => b.block === "Chem");
  const g1Row = chemBlock.rows.find((r) => r.groupId === "g1");
  assert.deepEqual(g1Row.teacherNames, ["Amy"]);
  assert.equal(g1Row.complete, true);
  assert.equal(g1Row.note, "Banded with g2");
});

test("buildDeploymentView() marks a co-taught group complete only when both seats are filled, and flags placeholder use", () => {
  const view = buildDeploymentView(fixture());
  const level3 = view.find((l) => l.level === 3);
  const chemBlock = level3.blocks.find((b) => b.block === "Chem");
  const g3Row = chemBlock.rows.find((r) => r.groupId === "g3");
  assert.deepEqual(g3Row.teacherNames.sort(), ["Amy", "New Teacher"]);
  assert.equal(g3Row.complete, true);
  assert.equal(g3Row.hasPlaceholder, true);
});

test("buildDeploymentView() marks an unassigned group incomplete with no teacher names", () => {
  const view = buildDeploymentView(fixture());
  const level1 = view.find((l) => l.level === 1);
  const row = level1.blocks[0].rows[0];
  assert.equal(row.groupId, "g4");
  assert.deepEqual(row.teacherNames, []);
  assert.equal(row.complete, false);
});

test("buildDeploymentView() flags a locked assignment", () => {
  const view = buildDeploymentView(fixture());
  const level3 = view.find((l) => l.level === 3);
  const phyBlock = level3.blocks.find((b) => b.block === "Phy");
  const row = phyBlock.rows.find((r) => r.groupId === "g2");
  assert.equal(row.anyLocked, true);
});

test("buildDeploymentView() puts an unrecognised block after the canonical ones, alphabetically", () => {
  const data = fixture();
  data.groups.push({
    id: "g5",
    level: 3,
    block: "Art",
    label: "301 Art",
    periods: 2,
    band: null,
    teachersNeeded: 1,
    category: "",
    note: "",
  });
  const view = buildDeploymentView(data);
  const level3 = view.find((l) => l.level === 3);
  assert.deepEqual(
    level3.blocks.map((b) => b.block),
    ["Chem", "Phy", "Art"],
  );
});

// buildSummary() / buildTeacherView() need schema v2 fields (roles,
// teacher.roleId/capOverride) that effectiveCap() relies on - the v1-shaped
// fixture() above predates schema v2, so these use a dedicated fixture.
function fixtureV2() {
  return {
    roles: [
      { id: "teacher", name: "Teacher", maxPeriods: 20 },
      { id: "others", name: "Others", maxPeriods: null },
    ],
    teachers: [
      {
        id: "t1",
        name: "Amy",
        roleId: "teacher",
        capOverride: null,
        qualifications: [],
      },
      {
        id: "t2",
        name: "Ben",
        roleId: "teacher",
        capOverride: null,
        qualifications: [],
      },
      // "Others"-role teacher with no cap entered - mis-configured, should
      // be flagged by teachersUnderRole (mirrors setup.js's setupWarnings).
      {
        id: "t3",
        name: "Cam",
        roleId: "others",
        capOverride: null,
        qualifications: [],
      },
      // Low per-teacher cap override, assigned enough load to exceed it.
      {
        id: "t4",
        name: "Dee",
        roleId: "teacher",
        capOverride: 5,
        qualifications: [],
      },
      {
        id: "t9",
        name: "New Teacher",
        roleId: "teacher",
        capOverride: null,
        qualifications: [],
        isPlaceholder: true,
      },
    ],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Chem",
        label: "301 Chem",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        category: "G1",
        note: "",
      },
      {
        id: "g2",
        level: 3,
        block: "Phy",
        label: "301 Phy",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        category: "G1",
        note: "",
      },
      {
        id: "g3",
        level: 3,
        block: "Chem",
        label: "406 EXP Chem",
        periods: 4,
        band: null,
        teachersNeeded: 2,
        category: "EXP",
        note: "Co-taught",
      },
      {
        id: "g4",
        level: 1,
        block: "LSS",
        label: "1G1A SCI",
        periods: 5,
        band: null,
        teachersNeeded: 1,
        category: "G1",
        note: "",
      },
      {
        id: "g5",
        level: 3,
        block: "Chem",
        label: "301 Chem Enrichment",
        periods: 6,
        band: null,
        teachersNeeded: 1,
        category: "ENRICH",
        note: "",
      },
    ],
    assignments: [
      { teacherId: "t1", groupId: "g1", locked: false },
      { teacherId: "t2", groupId: "g2", locked: true },
      { teacherId: "t1", groupId: "g3", locked: false },
      { teacherId: "t9", groupId: "g3", locked: false }, // placeholder fills the co-taught seat
      { teacherId: "t4", groupId: "g5", locked: false }, // Dee: 6 periods > her 5-period cap
      // g4 is deliberately left unassigned.
    ],
  };
}

test("buildSummary() counts complete vs incomplete groups", () => {
  const summary = buildSummary(fixtureV2());
  // g1, g2, g3 (2/2), g5 are filled; g4 is not.
  assert.equal(summary.totalGroups, 5);
  assert.equal(summary.groupsFilled, 4);
  assert.equal(summary.groupsIncomplete, 1);
});

test("buildSummary() counts seats and placeholder seats", () => {
  const summary = buildSummary(fixtureV2());
  assert.equal(summary.seatsTotal, 6); // 1+1+2+1+1
  assert.equal(summary.seatsFilled, 5); // all 5 assignments reference real groups
  assert.equal(summary.placeholderSeats, 1); // t9 -> g3
});

test("buildSummary() flags a teacher over their effective cap", () => {
  const summary = buildSummary(fixtureV2());
  assert.deepEqual(summary.teachersOverCap, [
    { teacherId: "t4", name: "Dee", load: 6, cap: 5 },
  ]);
});

test('buildSummary() flags an "Others"-role teacher with no capOverride set', () => {
  const summary = buildSummary(fixtureV2());
  assert.deepEqual(summary.teachersUnderRole, [
    { teacherId: "t3", name: "Cam" },
  ]);
});

test("buildSummary() returns zeros/empty arrays for an empty data set without throwing", () => {
  const summary = buildSummary({
    teachers: [],
    groups: [],
    assignments: [],
    roles: [],
  });
  assert.deepEqual(summary, {
    totalGroups: 0,
    groupsFilled: 0,
    groupsIncomplete: 0,
    seatsTotal: 0,
    seatsFilled: 0,
    placeholderSeats: 0,
    teachersOverCap: [],
    teachersUnderRole: [],
  });
});

test("buildSummary() runs against the real sample school without throwing", () => {
  const sample = loadSample();
  const summary = buildSummary(sample);
  assert.equal(summary.totalGroups, sample.groups.length);
  assert.ok(summary.seatsTotal >= summary.seatsFilled);
});

test("buildTeacherView() reports a teacher's total load and lists all their assigned groups", () => {
  const view = buildTeacherView(fixtureV2());
  const amy = view.find((r) => r.teacherId === "t1");
  assert.equal(amy.load, 8); // g1 (4) + g3 (4)
  assert.deepEqual(amy.groups.map((g) => g.groupId).sort(), ["g1", "g3"]);
});

test("buildTeacherView() includes teachers with no assignments (load 0, empty groups)", () => {
  const view = buildTeacherView(fixtureV2());
  const cam = view.find((r) => r.teacherId === "t3");
  assert.equal(cam.load, 0);
  assert.deepEqual(cam.groups, []);
});

test("buildTeacherView() flags overCap when load exceeds effectiveCap", () => {
  const view = buildTeacherView(fixtureV2());
  const dee = view.find((r) => r.teacherId === "t4");
  assert.equal(dee.cap, 5);
  assert.equal(dee.load, 6);
  assert.equal(dee.overCap, true);
  const amy = view.find((r) => r.teacherId === "t1");
  assert.equal(amy.overCap, false);
});

test("buildTeacherView() shows locked:true on a locked assignment's group entry", () => {
  const view = buildTeacherView(fixtureV2());
  const ben = view.find((r) => r.teacherId === "t2");
  const g2Entry = ben.groups.find((g) => g.groupId === "g2");
  assert.equal(g2Entry.locked, true);
});

test("buildTeacherView() sorts by roleName then by name", () => {
  const view = buildTeacherView(fixtureV2());
  // "Others" sorts before "Teacher"; within "Teacher", alphabetical by name.
  assert.deepEqual(
    view.map((r) => r.name),
    ["Cam", "Amy", "Ben", "Dee", "New Teacher"],
  );
});

test("buildTeacherView() runs against the real sample school without throwing", () => {
  const sample = loadSample();
  const view = buildTeacherView(sample);
  assert.equal(view.length, sample.teachers.length);
  for (const row of view) {
    assert.equal(typeof row.load, "number");
    assert.equal(typeof row.cap, "number");
    assert.ok(Array.isArray(row.groups));
  }
});
