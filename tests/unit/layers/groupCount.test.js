import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";
import { preCheck, explainConstraint } from "../../../src/diagnose.js";
import { validate } from "../../../src/data.js";

const OFF = (id) => ({ id, enabled: false, weight: 0 });

function group(id, periods) {
  return {
    id,
    level: 3,
    block: "A",
    label: id,
    periods,
    band: null,
    bandId: null,
    teachersNeeded: 1,
    subjectId: "A",
  };
}

function makeData(t1Extra = {}, t2Extra = {}) {
  const teacher = (id, extra) => ({
    id,
    name: id,
    roleId: "r",
    capOverride: 100,
    qualifications: ["A"],
    ...extra,
  });
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
    ],
    bands: [],
    teachers: [teacher("t1", t1Extra), teacher("t2", t2Extra)],
    groups: [
      group("big1", 10),
      group("big2", 12),
      group("s1", 6),
      group("s2", 6),
    ],
    assignments: [],
    layerSettings: [OFF("balance"), OFF("mix"), OFF("preps"), OFF("stable")],
  };
}

const rows = (model, prefix) =>
  model.constraints.filter((c) => c.name.startsWith(prefix));

test("groupCount adds no rows when no teacher has a rule", () => {
  assert.equal(rows(buildModel(makeData()), "groupCount_").length, 0);
});

test("groupCount emits one row per set field with the right op and rhs", () => {
  const model = buildModel(
    makeData({ bigCount: 1, smallCount: 0, maxGroups: 3 }),
  );
  const byName = new Map(model.constraints.map((c) => [c.name, c]));
  const max = byName.get("groupCount_max_t1");
  const big = byName.get("groupCount_big_t1");
  const small = byName.get("groupCount_small_t1");
  assert.deepEqual([max.op, max.rhs, max.terms.length], ["<=", 3, 4]);
  assert.deepEqual([big.op, big.rhs, big.terms.length], ["=", 1, 2]);
  // A count of 0 is a real rule ("no small groups"), not "blank".
  assert.deepEqual([small.op, small.rhs, small.terms.length], ["=", 0, 2]);
  assert.equal(rows(model, "groupCount_").length, 3);
});

test("solve honours exact big/small counts and the max groups", async () => {
  const data = makeData({ bigCount: 1, smallCount: 1 }, { maxGroups: 2 });
  const result = await solveModel(buildModel(data));
  assert.ok(result.optimal);
  const gById = new Map(data.groups.map((g) => [g.id, g]));
  const mine = (id) =>
    result.assignments
      .filter((a) => a.teacherId === id)
      .map((a) => gById.get(a.groupId));
  const t1 = mine("t1");
  assert.equal(t1.filter((g) => g.periods >= 10).length, 1);
  assert.equal(t1.filter((g) => g.periods < 10).length, 1);
  assert.ok(mine("t2").length <= 2);
});

test("an exact count with no eligible group still produces an (infeasible) row", () => {
  const data = makeData({ bigCount: 1 });
  data.teachers[0].qualifications = [];
  const row = rows(buildModel(data), "groupCount_big_")[0];
  assert.equal(row.terms.length, 0);
  assert.equal(row.rhs, 1);
});

test("preCheck explains an exact count above what the teacher is qualified for", () => {
  const data = makeData({ bigCount: 5 });
  const issues = preCheck(data, buildModel(data));
  assert.ok(issues.some((s) => /"t1" is set to 5 big group\(s\)/.test(s)));
});

test("preCheck flags big+small above the max groups", () => {
  const data = makeData({ bigCount: 2, smallCount: 2, maxGroups: 3 });
  const issues = preCheck(data, buildModel(data));
  assert.ok(issues.some((s) => /more than their maximum of 3/.test(s)));
});

test("explainConstraint names the teacher and the number", () => {
  const data = makeData({ bigCount: 2, maxGroups: 4 });
  assert.match(
    explainConstraint("groupCount_big_t1", data, 1),
    /"t1" is set to exactly 2 big/,
  );
  assert.match(explainConstraint("groupCount_max_t1", data, 1), /maximum of 4/);
});

test("validate() accepts null/whole numbers and rejects the rest", () => {
  assert.deepEqual(
    validate(makeData({ bigCount: null, smallCount: 0, maxGroups: 3 })),
    [],
  );
  const errs = validate(
    makeData({ bigCount: -1, smallCount: 1.5, maxGroups: "x" }),
  );
  assert.equal(errs.filter((e) => /whole number/.test(e)).length, 3);
});

test("mix skips a teacher whose big/small counts are fixed", () => {
  const data = makeData({ bigCount: 1, smallCount: 1 });
  data.layerSettings = [OFF("balance"), OFF("preps"), OFF("stable")];
  const mixRows = rows(buildModel(data), "mix_");
  assert.ok(mixRows.every((c) => !c.name.endsWith("_t1")));
  assert.ok(mixRows.some((c) => c.name.endsWith("_t2")));
});
