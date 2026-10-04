import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validate,
  graduatingSettings,
  prepKey,
  isDenied,
  formatDeny,
  parseDeny,
} from "../../src/data.js";

const base = () => ({
  teachers: [{ id: "t1", name: "Amy" }],
  groups: [],
  assignments: [],
});

test("graduatingSettings() defaults and falls back on nonsense", () => {
  assert.deepEqual(graduatingSettings({}), {
    levels: [4, 5],
    max: 3,
    prefer: 2,
  });
  assert.deepEqual(
    graduatingSettings({
      settings: {
        graduatingLevels: [5],
        maxGraduating: 4,
        preferGraduating: 1,
      },
    }),
    { levels: [5], max: 4, prefer: 1 },
  );
  assert.deepEqual(
    graduatingSettings({
      settings: {
        graduatingLevels: [],
        maxGraduating: -1,
        preferGraduating: "x",
      },
    }),
    { levels: [4, 5], max: 3, prefer: 2 },
  );
  // "prefer" can never be above the hard maximum.
  assert.equal(
    graduatingSettings({ settings: { maxGraduating: 1, preferGraduating: 2 } })
      .prefer,
    1,
  );
});

test("prepKey() separates subject, stream and level", () => {
  const g = { subjectId: "G2_SCI_CHEM", stream: "G2", level: 3 };
  assert.notEqual(prepKey(g), prepKey({ ...g, level: 4 }));
  assert.notEqual(prepKey(g), prepKey({ ...g, subjectId: "G2_SCI_PHY" }));
  assert.equal(prepKey(g), prepKey({ ...g, classIds: ["301"] }));
  // A group with no subjectId falls back to its block.
  assert.notEqual(
    prepKey({ block: "Chem", level: 3 }),
    prepKey({ block: "Phy", level: 3 }),
  );
});

test("isDenied() matches level, stream and subject; a missing part means any", () => {
  const g = { level: 1, stream: "G2", subjectId: "G2_LSS" };
  const t = (denies) => ({ denies });
  assert.equal(isDenied(t([{ level: 1 }]), g), true);
  assert.equal(isDenied(t([{ level: 2 }]), g), false);
  assert.equal(isDenied(t([{ level: 1, stream: "G2" }]), g), true);
  assert.equal(isDenied(t([{ level: 1, stream: "G3" }]), g), false);
  assert.equal(isDenied(t([{ subjectId: "G2_LSS" }]), g), true);
  assert.equal(isDenied(t([{ stream: "G3" }, { level: 1 }]), g), true);
  assert.equal(isDenied({}, g), false);
  assert.equal(isDenied(t([]), g), false);
  // An empty rule would deny everything; it must deny nothing instead.
  assert.equal(isDenied(t([{}]), g), false);
});

test("streams are case-insensitive: a typed 'g2' still denies G2", () => {
  assert.deepEqual(parseDeny("1:g2:"), { level: 1, stream: "G2" });
  const g = { level: 1, stream: "G2", subjectId: "x" };
  assert.equal(isDenied({ denies: [{ level: 1, stream: "g2" }] }, g), true);
  assert.equal(isDenied({ denies: [{ stream: "g3" }] }, g), false);
});

test("validate() takes lastYear[].applied only as a boolean", () => {
  const row = { level: 1, classRef: "101", subjectId: "s", teacherId: "t1" };
  assert.deepEqual(
    validate({ ...base(), lastYear: [{ ...row, applied: true }] }),
    [],
  );
  assert.deepEqual(
    validate({ ...base(), lastYear: [{ ...row, applied: false }] }),
    [],
  );
  assert.ok(
    validate({ ...base(), lastYear: [{ ...row, applied: "yes" }] }).some((m) =>
      m.includes("lastYear[0].applied"),
    ),
  );
});

test("formatDeny()/parseDeny() round-trip", () => {
  for (const rule of [
    { level: 1, stream: "G2" },
    { level: 3 },
    { stream: "G3", subjectId: "G3_SCI_CHEM" },
    { subjectId: "G1_LSS" },
  ]) {
    assert.deepEqual(parseDeny(formatDeny(rule)), rule);
  }
  assert.equal(formatDeny({ level: 1, stream: "G2" }), "1:G2:");
  assert.deepEqual(parseDeny(" : : "), {});
});

test("validate() accepts old data and the new optional fields", () => {
  assert.deepEqual(validate(base()), []);
  const data = {
    ...base(),
    classes: [{ id: "101", level: 1, name: "Curiosity", formTeacherId: "t1" }],
    teachers: [{ id: "t1", name: "Amy", denies: [{ level: 1, stream: "G2" }] }],
    lastYear: [
      { level: 1, classRef: "101", subjectId: "G1_LSS", teacherId: "t1" },
    ],
    settings: {
      graduatingLevels: [4, 5],
      maxGraduating: 3,
      preferGraduating: 2,
    },
  };
  assert.deepEqual(validate(data), []);
});

test("validate() rejects malformed new fields with plain messages", () => {
  const msgs = (patch) => validate({ ...base(), ...patch });
  assert.ok(
    msgs({
      classes: [{ id: "c", level: 1, name: "X", formTeacherId: 5 }],
    }).some((m) => m.includes("formTeacherId")),
  );
  assert.ok(
    msgs({ teachers: [{ id: "t1", name: "A", denies: "no" }] }).some((m) =>
      m.includes("denies must be an array"),
    ),
  );
  assert.ok(
    msgs({ teachers: [{ id: "t1", name: "A", denies: [{}] }] }).some((m) =>
      m.includes("must name a level, stream or subject"),
    ),
  );
  assert.ok(
    msgs({ teachers: [{ id: "t1", name: "A", denies: [{ level: 0 }] }] }).some(
      (m) => m.includes("denies[0].level"),
    ),
  );
  assert.ok(
    msgs({ lastYear: "x" }).some((m) =>
      m.includes("lastYear must be an array"),
    ),
  );
  assert.ok(
    msgs({
      lastYear: [{ level: 1, classRef: "", subjectId: "s", teacherId: "t1" }],
    }).some((m) => m.includes("lastYear[0].classRef")),
  );
  assert.ok(
    msgs({ settings: { maxGraduating: 1.5 } }).some((m) =>
      m.includes("settings.maxGraduating"),
    ),
  );
  assert.ok(
    msgs({ settings: { maxGraduating: 2, preferGraduating: 3 } }).some((m) =>
      m.includes("preferGraduating"),
    ),
  );
  assert.ok(
    msgs({ settings: { graduatingLevels: ["x"] } }).some((m) =>
      m.includes("settings.graduatingLevels"),
    ),
  );
});
