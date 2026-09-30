import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";

// 3 qualified teachers with different caps (one is a reduced-cap HOD) and
// 6 identical 6-period groups: 36 periods of demand against 100 of cap, so
// a fair split is 36% each => 12 / 12 / 12 periods... except the HOD's
// proportional share is smaller (cap 20 => 7.2 periods), so a proportional
// solve gives Amy 15+ periods, Ben 15+, Cat ~6.
function fixture(layerSettings) {
  const group = (i) => ({
    id: `g${i}`,
    level: 3,
    block: "Chem",
    label: `Group ${i}`,
    periods: 6,
    band: null,
    bandId: null,
    teachersNeeded: 1,
    subjectId: "chem",
  });
  return {
    roles: [{ id: "r", name: "R", maxPeriods: null }],
    subjects: [
      {
        id: "chem",
        name: "Chem",
        discipline: "CHEM",
        stream: "G1",
        periods: 6,
        levels: [3],
      },
    ],
    bands: [],
    teachers: [
      {
        id: "t1",
        name: "Amy",
        roleId: "r",
        capOverride: 40,
        qualifications: ["chem"],
      },
      {
        id: "t2",
        name: "Ben",
        roleId: "r",
        capOverride: 40,
        qualifications: ["chem"],
      },
      {
        id: "t3",
        name: "Cat",
        roleId: "r",
        capOverride: 20,
        qualifications: ["chem"],
      },
    ],
    groups: [1, 2, 3, 4, 5, 6].map(group),
    assignments: [],
    layerSettings,
  };
}

function loadsOf(data, assignments) {
  const per = new Map(data.groups.map((g) => [g.id, g.periods]));
  const load = new Map(data.teachers.map((t) => [t.id, 0]));
  for (const a of assignments)
    load.set(a.teacherId, load.get(a.teacherId) + per.get(a.groupId));
  return load;
}

test("balance adds max/min/deviation rows for each eligible teacher", () => {
  const model = buildModel(fixture([]));
  const names = model.constraints.map((c) => c.name);
  for (const t of ["t1", "t2", "t3"]) {
    assert.ok(names.includes(`balance_max_${t}`));
    assert.ok(names.includes(`balance_min_${t}`));
    assert.ok(names.includes(`balance_devHi_${t}`));
    assert.ok(names.includes(`balance_devLo_${t}`));
  }
});

test("balance layer disabled => no balance rows", () => {
  const model = buildModel(
    fixture([{ id: "balance", enabled: false, weight: 1 }]),
  );
  assert.equal(
    model.constraints.filter((c) => c.name.startsWith("balance_")).length,
    0,
  );
});

test("balance spreads load in proportion to each teacher's cap", async () => {
  const data = fixture([{ id: "balance", enabled: true, weight: 1 }]);
  const result = await solveModel(buildModel(data));
  assert.ok(result.optimal);
  const load = loadsOf(data, result.assignments);
  // Demand 36 of 100 cap => fair share 36%: Amy/Ben 12-18 (30-45%), Cat 6 (30%).
  const util = (id, cap) => load.get(id) / cap;
  const spread =
    Math.max(util("t1", 40), util("t2", 40), util("t3", 20)) -
    Math.min(util("t1", 40), util("t2", 40), util("t3", 20));
  assert.ok(spread <= 0.16, `utilisation spread too wide: ${spread}`);
  assert.ok(
    load.get("t3") >= 6,
    "small-cap teacher should still carry a share",
  );
});

test("balance never makes a feasible model infeasible", async () => {
  const data = fixture([{ id: "balance", enabled: true, weight: 100 }]);
  data.teachers[2].capOverride = 6; // Cat can take exactly one group.
  const result = await solveModel(buildModel(data));
  assert.ok(result.optimal);
  assert.equal(result.assignments.length, 6);
});
