import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDeploymentView } from "../../src/view.js";

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
