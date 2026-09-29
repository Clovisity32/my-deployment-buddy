import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  emptyData,
  validate,
  migrateV1,
  effectiveCap,
} from "../../src/data.js";
import { qualificationLayer } from "../../src/layers/qualification.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplePath = path.join(__dirname, "../../sample/sample.json");

test("emptyData() has no validation errors", () => {
  assert.deepEqual(validate(emptyData()), []);
});

test("validate() accepts the fictional sample school (v2)", () => {
  const sample = JSON.parse(readFileSync(samplePath, "utf8"));
  const errors = validate(sample);
  assert.deepEqual(errors, []);
});

test("validate() rejects non-object input", () => {
  assert.ok(validate(null).length > 0);
  assert.ok(validate(undefined).length > 0);
  assert.ok(validate("not an object").length > 0);
  assert.ok(validate(42).length > 0);
});

test("validate() rejects missing/wrong-typed teachers array", () => {
  const errors = validate({ teachers: "nope", groups: [] });
  assert.ok(errors.some((e) => e.includes("teachers must be an array")));
});

test("validate() flags duplicate teacher ids", () => {
  const data = {
    teachers: [
      { id: "t1", name: "A", maxPeriods: 20, subjects: ["Chem"] },
      { id: "t1", name: "B", maxPeriods: 20, subjects: ["Phy"] },
    ],
    groups: [],
  };
  const errors = validate(data);
  assert.ok(errors.some((e) => e.includes("duplicated")));
});

test("validate() flags a group with non-positive periods", () => {
  const data = {
    teachers: [],
    groups: [
      {
        id: "g1",
        level: 1,
        block: "Chem",
        label: "x",
        periods: 0,
        band: null,
        teachersNeeded: 1,
      },
    ],
  };
  const errors = validate(data);
  assert.ok(
    errors.some((e) => e.includes("periods must be a positive number")),
  );
});

test("validate() flags an assignment referencing an unknown teacher or group", () => {
  const data = {
    teachers: [{ id: "t1", name: "A", maxPeriods: 20, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 1,
        block: "Chem",
        label: "x",
        periods: 4,
        band: null,
        teachersNeeded: 1,
      },
    ],
    assignments: [{ groupId: "g1", teacherId: "ghost", locked: false }],
  };
  const errors = validate(data);
  assert.ok(errors.some((e) => e.includes("does not match any teacher")));
});

test("validate() accepts a valid assignment", () => {
  const data = {
    teachers: [{ id: "t1", name: "A", maxPeriods: 20, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 1,
        block: "Chem",
        label: "x",
        periods: 4,
        band: null,
        teachersNeeded: 1,
      },
    ],
    assignments: [{ groupId: "g1", teacherId: "t1", locked: false }],
  };
  assert.deepEqual(validate(data), []);
});

// --- effectiveCap ---------------------------------------------------------

test("effectiveCap() falls back to the teacher's role cap", () => {
  const data = {
    roles: [{ id: "teacher", name: "Teacher", maxPeriods: 60 }],
  };
  const teacher = { id: "t1", name: "A", roleId: "teacher", capOverride: null };
  assert.equal(effectiveCap(data, teacher), 60);
});

test("effectiveCap() lets capOverride win over the role cap", () => {
  const data = {
    roles: [{ id: "teacher", name: "Teacher", maxPeriods: 60 }],
  };
  const teacher = { id: "t1", name: "A", roleId: "teacher", capOverride: 40 };
  assert.equal(effectiveCap(data, teacher), 40);
});

test("effectiveCap() returns 0 for an Others teacher with no capOverride", () => {
  const data = {
    roles: [{ id: "others", name: "Others", maxPeriods: null }],
  };
  const teacher = { id: "t1", name: "A", roleId: "others", capOverride: null };
  assert.equal(effectiveCap(data, teacher), 0);
});

test("effectiveCap() honours capOverride even when the role's maxPeriods is null", () => {
  const data = {
    roles: [{ id: "others", name: "Others", maxPeriods: null }],
  };
  const teacher = { id: "t1", name: "A", roleId: "others", capOverride: 12 };
  assert.equal(effectiveCap(data, teacher), 12);
});

// --- migrateV1 -------------------------------------------------------------

test("migrateV1() produces valid v2 data from a v1-shaped sample", () => {
  const sample = JSON.parse(readFileSync(samplePath, "utf8"));
  const migrated = migrateV1(sample);
  assert.deepEqual(validate(migrated), []);
});

test("migrateV1() preserves each teacher's old maxPeriods as capOverride under the Others role", () => {
  const v1 = {
    teachers: [{ id: "t1", name: "Amy", maxPeriods: 28, subjects: ["Chem"] }],
    groups: [],
  };
  const migrated = migrateV1(v1);
  const t = migrated.teachers.find((x) => x.id === "t1");
  assert.equal(t.roleId, "others");
  assert.equal(t.capOverride, 28);
  // qualifications reuses the old free-text `subjects` list as a 1:1
  // stand-in - see the regression test below for why.
  assert.deepEqual(t.qualifications, ["Chem"]);
  assert.equal(t.maxPeriods, undefined);
});

test("migrateV1() keeps a migrated teacher qualified for a migrated group in the same v1 subject block (regression: qualification.filterPairs must not fail-closed post-migration)", () => {
  const v1 = {
    teachers: [{ id: "t1", name: "Amy", maxPeriods: 28, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 1,
        block: "Chem",
        label: "x",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        category: "G1",
        note: "",
      },
    ],
  };
  const migrated = migrateV1(v1);
  const pairs = [{ teacherId: "t1", groupId: "g1" }];
  const survivors = qualificationLayer.filterPairs(migrated, pairs);
  assert.deepEqual(survivors, pairs);
});

test("migrateV1() turns every v1 group into a customGroups entry and stamps subjectId=block on the kept groups entry", () => {
  const v1 = {
    teachers: [],
    groups: [
      {
        id: "g1",
        level: 1,
        block: "Chem",
        label: "x",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        category: "G1",
        note: "",
      },
    ],
  };
  const migrated = migrateV1(v1);
  assert.equal(migrated.groups.length, 1);
  // Same group, but stamped with subjectId=block (see regression test above)
  // - the customGroups copy stays untouched with subjectId: null as before.
  assert.deepEqual(migrated.groups[0], {
    ...v1.groups[0],
    subjectId: v1.groups[0].block,
  });
  assert.equal(migrated.customGroups.length, 1);
  assert.equal(migrated.customGroups[0].id, "g1");
  assert.equal(migrated.customGroups[0].subjectId, null);
});

test("migrateV1() carries over assignments/layerSettings/versions unchanged", () => {
  const v1 = {
    teachers: [{ id: "t1", name: "Amy", maxPeriods: 28, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 1,
        block: "Chem",
        label: "x",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        category: "G1",
        note: "",
      },
    ],
    assignments: [{ groupId: "g1", teacherId: "t1", locked: false }],
    layerSettings: [{ id: "coverage", enabled: true, weight: 1 }],
    versions: [],
  };
  const migrated = migrateV1(v1);
  assert.deepEqual(migrated.assignments, v1.assignments);
  assert.deepEqual(migrated.layerSettings, v1.layerSettings);
  assert.deepEqual(migrated.versions, v1.versions);
});

// --- validate() on schema v2 -----------------------------------------------

function v2Fixture() {
  return {
    roles: [
      { id: "hod", name: "HOD", maxPeriods: 36 },
      { id: "others", name: "Others", maxPeriods: null },
    ],
    subjects: [
      {
        id: "G1_LSS",
        name: "G1 LSS",
        discipline: "LSS",
        stream: "G1",
        periods: 5,
        levels: [1, 2],
      },
    ],
    classes: [
      { id: "101", level: 1, name: "Curiosity", subjectIds: ["G1_LSS"] },
    ],
    bands: [],
    teachers: [
      {
        id: "t1",
        name: "Amy",
        roleId: "hod",
        capOverride: null,
        qualifications: ["G1_LSS"],
      },
    ],
    groups: [
      {
        id: "g_G1_LSS_101",
        level: 1,
        block: "LSS",
        label: "101 G1 LSS",
        periods: 5,
        band: null,
        teachersNeeded: 1,
        category: "G1",
        note: "",
        subjectId: "G1_LSS",
        discipline: "LSS",
        stream: "G1",
        classIds: ["101"],
        bandId: null,
      },
    ],
    groupOverrides: {},
    customGroups: [],
    assignments: [],
    layerSettings: [],
    versions: [],
  };
}

test("validate() accepts a fully-populated v2 sample", () => {
  assert.deepEqual(validate(v2Fixture()), []);
});

test("validate() rejects a duplicate subject id", () => {
  const data = v2Fixture();
  data.subjects.push({ ...data.subjects[0] });
  const errors = validate(data);
  assert.ok(
    errors.some(
      (e) => e.includes("subjects[1].id") && e.includes("duplicated"),
    ),
  );
});

test("validate() flags a teacher roleId that points nowhere when roles is non-empty", () => {
  const data = v2Fixture();
  data.teachers[0].roleId = "ghost_role";
  const errors = validate(data);
  assert.ok(errors.some((e) => e.includes("does not match any role")));
});

test("validate() does not require roleId when roles is empty", () => {
  const data = v2Fixture();
  data.roles = [];
  delete data.teachers[0].roleId;
  assert.deepEqual(validate(data), []);
});
