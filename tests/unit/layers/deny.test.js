import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";
import { preCheck } from "../../../src/diagnose.js";
import { fixture, group, teacher, QUIET, OFF } from "./rulesFixture.js";

const data = (denies, layerSettings = QUIET) =>
  fixture({
    teachers: [teacher("t1", ["A"], { denies }), teacher("t2", ["A"])],
    groups: [
      group("g1", "A", { level: 1 }),
      group("g3", "A", { level: 3, stream: "G3" }),
    ],
    layerSettings,
  });
const has = (m, t, g) =>
  m.pairs.some((p) => p.teacherId === t && p.groupId === g);

test("deny removes a denied (teacher, group) pair before any variable exists", () => {
  const m = buildModel(data([{ level: 1 }]));
  assert.equal(has(m, "t1", "g1"), false);
  assert.equal(has(m, "t1", "g3"), true);
  assert.equal(has(m, "t2", "g1"), true);
});

test("a rule can name a stream or a subject", () => {
  assert.equal(has(buildModel(data([{ stream: "G3" }])), "t1", "g3"), false);
  assert.equal(has(buildModel(data([{ subjectId: "A" }])), "t1", "g1"), false);
  assert.equal(has(buildModel(data([{ subjectId: "B" }])), "t1", "g1"), true);
});

test("the solver gives a denied group to someone else", async () => {
  const result = await solveModel(buildModel(data([{ level: 1 }])));
  assert.ok(result.optimal);
  assert.equal(
    result.assignments.find((a) => a.groupId === "g1").teacherId,
    "t2",
  );
});

test("no denies, an empty rule, or a disabled layer keeps every pair", () => {
  for (const m of [
    buildModel(data(undefined)),
    buildModel(data([{}])),
    buildModel(data([{ level: 1 }], [...QUIET, OFF("deny")])),
  ]) {
    assert.equal(m.pairs.length, 4);
  }
});

test("preCheck says so when every qualified teacher is denied a group", () => {
  const d = fixture({
    teachers: [teacher("t1", ["A"], { denies: [{ level: 1 }] })],
    groups: [group("g1", "A", { level: 1 })],
  });
  const issues = preCheck(d, buildModel(d));
  assert.ok(
    issues.some((i) => i.includes("deny list")),
    issues.join("|"),
  );
});
