import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";

const OFF = (id) => ({ id, enabled: false, weight: 0 });
const ON = (id, weight) => ({ id, enabled: true, weight });

function group(id, subjectId, periods) {
  return {
    id,
    level: 3,
    block: subjectId,
    label: id,
    periods,
    band: null,
    bandId: null,
    teachersNeeded: 1,
    subjectId,
  };
}

function fixture({ teachers, groups, layerSettings }) {
  return {
    roles: [{ id: "r", name: "R", maxPeriods: null }],
    subjects: [
      {
        id: "A",
        name: "A",
        discipline: "A",
        stream: "G1",
        periods: 6,
        levels: [3],
      },
      {
        id: "B",
        name: "B",
        discipline: "B",
        stream: "G1",
        periods: 6,
        levels: [3],
      },
    ],
    bands: [],
    teachers,
    groups,
    assignments: [],
    layerSettings,
  };
}

const teacher = (id, quals) => ({
  id,
  name: id,
  roleId: "r",
  capOverride: 100,
  qualifications: quals,
});

function byTeacher(data, assignments) {
  const gById = new Map(data.groups.map((g) => [g.id, g]));
  const out = new Map(data.teachers.map((t) => [t.id, []]));
  for (const a of assignments) out.get(a.teacherId).push(gById.get(a.groupId));
  return out;
}

// ---------------------------------------------------------------- mix ----

function mixData(layerSettings) {
  return fixture({
    teachers: [teacher("t1", ["A"]), teacher("t2", ["A"])],
    groups: [
      group("big1", "A", 10),
      group("big2", "A", 12),
      group("small1", "A", 6),
      group("small2", "A", 6),
    ],
    layerSettings,
  });
}

test("mix gives each teacher about as many big groups as small ones", async () => {
  const data = mixData([OFF("balance"), ON("mix", 1)]);
  const result = await solveModel(buildModel(data));
  assert.ok(result.optimal);
  for (const [id, gs] of byTeacher(data, result.assignments)) {
    const big = gs.filter((g) => g.periods >= 10).length;
    const small = gs.length - big;
    assert.equal(big, small, `${id} has ${big} big and ${small} small`);
  }
});

test("mix adds no rows when it is disabled", () => {
  const model = buildModel(mixData([OFF("balance"), OFF("mix")]));
  assert.equal(
    model.constraints.filter((c) => c.name.startsWith("mix_")).length,
    0,
  );
});

test("mix ignores a teacher who could only ever get one size of group", () => {
  const data = fixture({
    // t2 is qualified for B, which only has small groups: no big/small choice.
    teachers: [teacher("t1", ["A"]), teacher("t2", ["B"])],
    groups: [
      group("big", "A", 10),
      group("small", "A", 6),
      group("b1", "B", 6),
      group("b2", "B", 6),
    ],
    layerSettings: [OFF("balance"), ON("mix", 1)],
  });
  const model = buildModel(data);
  const rows = model.constraints.filter((c) => c.name.startsWith("mix_"));
  assert.ok(rows.length > 0, "t1 should have mix rows");
  assert.ok(
    rows.every((c) => !c.name.endsWith("_t2")),
    "t2 must have none",
  );
});

test("mix never makes a feasible model infeasible", async () => {
  // 3 big groups, 1 small, one teacher: a perfect mix is impossible.
  const data = fixture({
    teachers: [teacher("t1", ["A"])],
    groups: [
      group("b1", "A", 10),
      group("b2", "A", 10),
      group("b3", "A", 10),
      group("s1", "A", 6),
    ],
    layerSettings: [OFF("balance"), ON("mix", 50)],
  });
  const result = await solveModel(buildModel(data));
  assert.ok(result.optimal);
  assert.equal(result.assignments.length, 4);
});

// -------------------------------------------------------------- preps ----

function prepsData(layerSettings) {
  return fixture({
    teachers: [teacher("t1", ["A", "B"]), teacher("t2", ["A", "B"])],
    groups: [
      group("a1", "A", 6),
      group("a2", "A", 6),
      group("b1", "B", 6),
      group("b2", "B", 6),
    ],
    layerSettings,
  });
}

function prepCount(data, assignments) {
  let n = 0;
  for (const gs of byTeacher(data, assignments).values()) {
    n += new Set(gs.map((g) => g.subjectId)).size;
  }
  return n;
}

test("preps keeps each teacher to as few different subjects as possible", async () => {
  const data = prepsData([OFF("balance"), ON("preps", 2)]);
  const result = await solveModel(buildModel(data));
  assert.ok(result.optimal);
  assert.equal(prepCount(data, result.assignments), 2); // one subject each, not 4
});

test("preps declares its yes/no variables as binary, and keeps them out of assignments", async () => {
  const data = prepsData([OFF("balance"), ON("preps", 2)]);
  const model = buildModel(data);
  assert.ok(model.extraBinaryVars.length > 0);
  for (const v of model.extraBinaryVars) {
    assert.ok(model.lp.includes(`\n ${v}`), `${v} missing from Binary section`);
  }
  const result = await solveModel(model);
  assert.equal(result.assignments.length, 4); // y variables never become assignments
});

test("preps adds no rows or variables when it is disabled", () => {
  const model = buildModel(prepsData([OFF("balance"), OFF("preps")]));
  assert.equal(
    model.constraints.filter((c) => c.name.startsWith("preps_")).length,
    0,
  );
  assert.equal(model.extraBinaryVars.length, 0);
});

test("preps never makes a feasible model infeasible", async () => {
  // t1 is the only one qualified for B, so they must carry 2 preps.
  const data = fixture({
    teachers: [teacher("t1", ["A", "B"]), teacher("t2", ["A"])],
    groups: [group("a1", "A", 6), group("a2", "A", 6), group("b1", "B", 6)],
    layerSettings: [OFF("balance"), ON("preps", 100)],
  });
  const result = await solveModel(buildModel(data));
  assert.ok(result.optimal);
  assert.equal(result.assignments.length, 3);
});
