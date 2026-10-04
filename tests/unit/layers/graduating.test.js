import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";
import { explainConstraint } from "../../../src/diagnose.js";
import { fixture, group, teacher, QUIET, ON, OFF } from "./rulesFixture.js";

// Four Sec 4 groups and two Sec 2 groups, two teachers who can teach any.
function data({ settings, layerSettings = QUIET, teachers } = {}) {
  return fixture({
    teachers: teachers ?? [teacher("t1", ["A"]), teacher("t2", ["A"])],
    groups: [
      ...[1, 2, 3, 4].map((i) => group(`g4${i}`, "A", { level: 4 })),
      ...[1, 2].map((i) => group(`g2${i}`, "A", { level: 2 })),
    ],
    layerSettings,
    settings,
  });
}
const gradCount = (result, tid) =>
  result.assignments.filter(
    (a) => a.teacherId === tid && a.groupId.startsWith("g4"),
  ).length;

test("graduatingMax caps each teacher at the maximum (default 3)", () => {
  const rows = buildModel(data()).constraints.filter((c) =>
    c.name.startsWith("graduatingMax_"),
  );
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every((r) => r.op === "<=" && r.rhs === 3 && r.terms.length === 4),
  );
});

test("with one teacher, 4 graduating groups are infeasible under a hard max of 3", async () => {
  const d = data({ teachers: [teacher("t1", ["A"])] });
  assert.equal((await solveModel(buildModel(d))).optimal, false);
});

test("the maximum and the levels come from settings", () => {
  const rows = buildModel(
    data({ settings: { maxGraduating: 1, graduatingLevels: [2] } }),
  ).constraints.filter((c) => c.name.startsWith("graduatingMax_"));
  assert.equal(rows.length, 2); // one row per teacher: 2 Sec 2 groups > a maximum of 1
  assert.ok(rows.every((r) => r.rhs === 1 && r.terms.length === 2)); // only the two Sec 2 groups
});

test("graduatingSpread spreads them 2 + 2 instead of 3 + 1 or 4 + 0", async () => {
  const d = data({ layerSettings: [...QUIET, ON("graduatingSpread", 5)] });
  const r = await solveModel(buildModel(d));
  assert.ok(r.optimal);
  assert.deepEqual([gradCount(r, "t1"), gradCount(r, "t2")], [2, 2]);
});

test("graduatingSpread only goes above the preferred 2 when it has to", async () => {
  const d = data({
    teachers: [
      teacher("t1", ["A"]),
      teacher("t2", ["A"]),
      teacher("t3", ["A"]),
    ],
    layerSettings: [...QUIET, ON("graduatingSpread", 5)],
  });
  const r = await solveModel(buildModel(d));
  for (const t of ["t1", "t2", "t3"])
    assert.ok(gradCount(r, t) <= 2, `${t} has ${gradCount(r, t)}`);
});

test("placeholder teachers are not capped, and disabled layers add nothing", () => {
  const d = data({
    teachers: [
      teacher("t1", ["A"]),
      teacher("ph", ["A"], { isPlaceholder: true }),
    ],
  });
  const names = buildModel(d).constraints.map((c) => c.name);
  assert.equal(
    names.some((n) => n === "graduatingMax_ph"),
    false,
  );
  const off = buildModel(
    data({
      layerSettings: [...QUIET, OFF("graduatingMax"), OFF("graduatingSpread")],
    }),
  );
  assert.equal(
    off.constraints.filter((c) => c.name.startsWith("graduating")).length,
    0,
  );
});

test("explainConstraint() explains a graduating-max clash in plain language", () => {
  const d = data();
  d.teachers[0].name = "Amy";
  const msg = explainConstraint("graduatingMax_t1", d, 1);
  assert.match(msg, /Amy/);
  assert.match(msg, /graduating/);
  assert.match(msg, /3/);
});
