import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildModel } from "../../src/model.js";
import { solveModel } from "../../src/solve.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplePath = path.join(__dirname, "../../sample/sample.json");

function loadSample() {
  return JSON.parse(readFileSync(samplePath, "utf8"));
}

// Small fixture with real ids from the actual deployment sheet's naming
// convention (dashes, e.g. "g-301") - this is a regression test for a bug
// where dashes inside a constraint name were read by the LP parser as a
// minus operator and corrupted the whole model.
function dashIdFixture() {
  return {
    teachers: [
      { id: "t-1", name: "Amy", maxPeriods: 8, subjects: ["Chem"] },
      { id: "t-2", name: "Ben", maxPeriods: 8, subjects: ["Phy"] },
    ],
    groups: [
      {
        id: "g-301",
        level: 3,
        block: "Chem",
        label: "301 Chem",
        periods: 4,
        band: null,
        teachersNeeded: 1,
      },
      {
        id: "g-401-402",
        level: 4,
        block: "Phy",
        label: "401 & 402 Phy",
        periods: 4,
        band: null,
        teachersNeeded: 1,
      },
    ],
    assignments: [],
  };
}

test("solveModel() solves a real MILP via the vendored HiGHS build (dash-containing ids)", async () => {
  const model = buildModel(dashIdFixture());
  const result = await solveModel(model);
  assert.equal(result.status, "Optimal");
  assert.equal(result.optimal, true);
  assert.equal(result.assignments.length, 2);
  assert.deepEqual(
    new Set(result.assignments.map((a) => `${a.teacherId}|${a.groupId}`)),
    new Set(["t-1|g-301", "t-2|g-401-402"]),
  );
});

test("solveModel() covers every group, respects qualifications and load caps on the fictional sample school", async () => {
  const data = loadSample();
  const model = buildModel(data);
  const result = await solveModel(model);
  assert.equal(result.status, "Optimal");

  const teacherById = new Map(data.teachers.map((t) => [t.id, t]));
  const groupById = new Map(data.groups.map((g) => [g.id, g]));

  // Every group gets exactly the teachers it needs.
  const countByGroup = new Map();
  for (const a of result.assignments) {
    countByGroup.set(a.groupId, (countByGroup.get(a.groupId) || 0) + 1);
  }
  for (const g of data.groups) {
    assert.equal(
      countByGroup.get(g.id) || 0,
      g.teachersNeeded,
      `group ${g.id} should have ${g.teachersNeeded} teacher(s)`,
    );
  }

  // Every assignment is to a qualified teacher.
  for (const a of result.assignments) {
    const t = teacherById.get(a.teacherId);
    const g = groupById.get(a.groupId);
    assert.ok(
      t.subjects.includes(g.block),
      `${t.name} is not qualified for ${g.label}`,
    );
  }

  // Nobody is over their load cap.
  const loadByTeacher = new Map();
  for (const a of result.assignments) {
    const g = groupById.get(a.groupId);
    loadByTeacher.set(
      a.teacherId,
      (loadByTeacher.get(a.teacherId) || 0) + g.periods,
    );
  }
  for (const t of data.teachers) {
    assert.ok(
      (loadByTeacher.get(t.id) || 0) <= t.maxPeriods,
      `${t.name} is over their cap`,
    );
  }
});

test("solveModel() is deterministic: solving the same model twice gives the same assignments", async () => {
  const model = buildModel(loadSample());
  const [first, second] = await Promise.all([
    solveModel(model),
    solveModel(model),
  ]);
  assert.equal(first.status, "Optimal");
  assert.equal(second.status, "Optimal");
  const key = (r) =>
    new Set(r.assignments.map((a) => `${a.teacherId}|${a.groupId}`));
  assert.deepEqual(key(first), key(second));
  assert.equal(first.objectiveValue, second.objectiveValue);
});

test("solveModel() honours a locked assignment even when it is not the cheapest option", async () => {
  const data = loadSample();
  // Lock the placeholder teacher onto a group a real teacher could cover -
  // the solver must keep it even though it's penalised by placeholder.js.
  data.assignments = [{ teacherId: "t9", groupId: "g-309-chem", locked: true }];
  const model = buildModel(data);
  const result = await solveModel(model);
  assert.equal(result.status, "Optimal");
  assert.ok(
    result.assignments.some(
      (a) => a.teacherId === "t9" && a.groupId === "g-309-chem",
    ),
    "expected the locked placeholder assignment to be honoured",
  );
});

test("solveModel() reports a non-Optimal status without throwing when a group has no qualified teacher", async () => {
  const data = loadSample();
  data.groups.push({
    id: "g-impossible",
    level: 3,
    block: "Art",
    label: "Impossible Art group",
    periods: 4,
    band: null,
    teachersNeeded: 1,
  });
  const model = buildModel(data);
  const result = await solveModel(model);
  assert.notEqual(result.status, "Optimal");
  assert.equal(result.optimal, false);
  assert.deepEqual(result.assignments, []);
});
