import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";

// Fixture: 2 teachers qualified for the same subject, 4 groups -
// bandA has 2 groups (a real clash risk), bandB has only 1 group (no
// possible clash), and one group isn't in any band at all.
function fixture() {
  return {
    roles: [{ id: "role1", name: "Role 1", maxPeriods: null }],
    subjects: [
      {
        id: "chem",
        name: "Chem",
        discipline: "CHEM",
        stream: "G1",
        periods: 4,
        levels: [3],
      },
    ],
    bands: [
      { id: "bandA", name: "Band A", classIds: [], subjects: [] },
      { id: "bandB", name: "Band B", classIds: [], subjects: [] },
    ],
    teachers: [
      {
        id: "t1",
        name: "Amy",
        roleId: "role1",
        capOverride: 20,
        qualifications: ["chem"],
      },
      {
        id: "t2",
        name: "Ben",
        roleId: "role1",
        capOverride: 20,
        qualifications: ["chem"],
      },
    ],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Chem",
        label: "Group A1",
        periods: 4,
        band: "bandA",
        bandId: "bandA",
        teachersNeeded: 1,
        subjectId: "chem",
      },
      {
        id: "g2",
        level: 3,
        block: "Chem",
        label: "Group A2",
        periods: 4,
        band: "bandA",
        bandId: "bandA",
        teachersNeeded: 1,
        subjectId: "chem",
      },
      {
        id: "g3",
        level: 3,
        block: "Chem",
        label: "Group B1",
        periods: 4,
        band: "bandB",
        bandId: "bandB",
        teachersNeeded: 1,
        subjectId: "chem",
      },
      {
        id: "g4",
        level: 3,
        block: "Chem",
        label: "Unbanded group",
        periods: 4,
        band: null,
        bandId: null,
        teachersNeeded: 1,
        subjectId: "chem",
      },
    ],
    assignments: [],
  };
}

test("bandClash adds a <=1 constraint per (band, teacher) only for bands with 2+ groups", () => {
  const model = buildModel(fixture());
  const bandClashNames = model.constraints
    .filter((c) => c.name.startsWith("bandClash_"))
    .map((c) => c.name);

  // bandA has 2 groups and 2 qualified teachers - one constraint each.
  assert.ok(bandClashNames.includes("bandClash_bandA_t1"));
  assert.ok(bandClashNames.includes("bandClash_bandA_t2"));

  // bandB has only 1 group - no possible clash, so no constraint at all,
  // for either teacher.
  assert.ok(!bandClashNames.some((n) => n.startsWith("bandClash_bandB_")));

  // Nothing else sneaks in beyond the 2 bandA constraints (g3's lone band
  // and g4's no-band contribute none).
  assert.equal(bandClashNames.length, 2);
});

test("bandClash constraint caps each teacher's variables within the band at 1", () => {
  const model = buildModel(fixture());
  const c = model.constraints.find((c) => c.name === "bandClash_bandA_t1");
  assert.ok(c);
  assert.equal(c.op, "<=");
  assert.equal(c.rhs, 1);
  assert.equal(c.terms.length, 2); // g1, g2
  assert.ok(c.terms.every((t) => t.coef === 1));
});

test("solveModel() never assigns one teacher to both groups in the same band", async () => {
  const model = buildModel(fixture());
  const result = await solveModel(model);
  assert.equal(result.status, "Optimal");

  const bandAAssignments = result.assignments.filter(
    (a) => a.groupId === "g1" || a.groupId === "g2",
  );
  assert.equal(bandAAssignments.length, 2); // both bandA groups get covered
  const teacherIds = bandAAssignments.map((a) => a.teacherId);
  assert.notEqual(
    teacherIds[0],
    teacherIds[1],
    "the same teacher should not cover both bandA groups",
  );
});

test("a band with a single group produces no bandClash constraint", () => {
  const data = fixture();
  data.groups = data.groups.filter((g) => g.id !== "g2"); // bandA now has only g1
  const model = buildModel(data);
  assert.ok(
    !model.constraints.some((c) => c.name.startsWith("bandClash_bandA_")),
  );
});

test("groups outside any band are unaffected by bandClash", () => {
  const model = buildModel(fixture());
  // g4 has no bandId - no constraint should ever reference it, and it
  // should still get a normal coverage constraint like any other group.
  assert.ok(model.constraints.some((c) => c.name === "coverage_g4"));
  assert.ok(
    !model.constraints.some(
      (c) => c.name.startsWith("bandClash_") && c.name.endsWith("_g4"),
    ),
  );
});
