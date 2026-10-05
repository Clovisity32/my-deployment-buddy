import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";
import {
  diagnoseInfeasibility,
  explainConstraint,
} from "../../../src/diagnose.js";
import { fixture, group, teacher, QUIET, OFF } from "./rulesFixture.js";

const cls = (id, formTeacherId) => ({ id, level: 3, name: id, formTeacherId });

// Two 6-period groups, two teachers with room for exactly one group each.
function twoByTwo(formTeacherId, layerSettings = QUIET) {
  return fixture({
    classes: [cls("c1", formTeacherId), cls("c2", null)],
    teachers: [
      teacher("t1", ["A"], { capOverride: 6 }),
      teacher("t2", ["A"], { capOverride: 6 }),
    ],
    groups: [
      group("g1", "A", { classIds: ["c1"] }),
      group("g2", "A", { classIds: ["c2"] }),
    ],
    layerSettings,
  });
}

test("adds one >= 1 row per class with a form teacher", () => {
  const m = buildModel(twoByTwo("t1"));
  const rows = m.constraints.filter((c) => c.name.startsWith("formTeacher_"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "formTeacher_c1");
  assert.equal(rows[0].op, ">=");
  assert.equal(rows[0].rhs, 1);
  assert.equal(rows[0].terms.length, 1); // only t1 x g1: g2 is not their class
});

test("the form teacher ends up teaching their own class", async () => {
  const result = await solveModel(buildModel(twoByTwo("t1")));
  assert.ok(result.optimal);
  assert.equal(
    result.assignments.find((a) => a.groupId === "g1").teacherId,
    "t1",
  );
  const other = await solveModel(buildModel(twoByTwo("t2")));
  assert.equal(
    other.assignments.find((a) => a.groupId === "g1").teacherId,
    "t2",
  );
});

test("no form teachers, an unknown teacher, a class with no groups, or a disabled layer add nothing", () => {
  const none = (d) =>
    buildModel(d).constraints.filter((c) => c.name.startsWith("formTeacher_"))
      .length;
  assert.equal(none(twoByTwo(null)), 0);
  assert.equal(none(twoByTwo("ghost")), 0);
  const d = twoByTwo("t1");
  d.classes.push(cls("c9", "t1")); // no group contains c9
  assert.equal(none(d), 1);
  assert.equal(none(twoByTwo("t1", [...QUIET, OFF("formTeacher")])), 0);
});

test("a form teacher who cannot teach any group of the class makes it infeasible, and says why", async () => {
  const d = fixture({
    classes: [cls("c1", "t1")],
    teachers: [teacher("t1", ["A"]), teacher("t2", ["B"])],
    groups: [group("g1", "B", { classIds: ["c1"] })],
  });
  const model = buildModel(d);
  assert.equal((await solveModel(model)).optimal, false);
  const { issues } = await diagnoseInfeasibility(d, model);
  assert.ok(
    issues.some((i) => i.includes("form teacher") && i.includes("t1")),
    issues.join("|"),
  );
});

test("explainConstraint() names the teacher and the class", () => {
  const d = twoByTwo("t1");
  d.teachers[0].name = "Amy";
  d.classes[0].name = "Curiosity";
  const msg = explainConstraint("formTeacher_c1", d, 1);
  assert.match(msg, /Amy/);
  assert.match(msg, /Sec 3 Curiosity/);
  assert.match(msg, /form teacher/);
  assert.match(explainConstraint("formTeacher_nope", d, 1), /form teacher/i);
});
