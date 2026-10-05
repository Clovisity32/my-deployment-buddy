import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fairnessWeights,
  idealClassCounts,
  FAIRNESS_KEY_BY_LAYER,
} from "../../src/fairness.js";

test("weights are 4^(level-1), and placeholder avoidance outranks them", () => {
  const w = fairnessWeights({});
  assert.deepEqual(
    [w.classCount, w.mix, w.preps, w.graduating],
    [256, 64, 16, 4], // classCountFirst 5/4/3/2
  );
  assert.equal(w.placeholder, 2560);
  const custom = fairnessWeights({
    settings: {
      fairness: {
        preset: "custom",
        levels: { classCount: 1, mix: 1, preps: 1, graduating: 1 },
      },
    },
  });
  assert.deepEqual(
    [
      custom.classCount,
      custom.mix,
      custom.preps,
      custom.graduating,
      custom.placeholder,
    ],
    [1, 1, 1, 1, 10],
  );
  assert.equal(
    fairnessWeights({ settings: { fairness: { preset: "balanced" } } })
      .classCount,
    64,
  );
  assert.deepEqual(FAIRNESS_KEY_BY_LAYER, {
    classCount: "classCount",
    mix: "mix",
    preps: "preps",
    graduatingSpread: "graduating",
  });
});

const roles = [
  { id: "teacher", name: "Teacher", maxPeriods: null },
  { id: "hod", name: "HOD", maxPeriods: null },
];
const teacher = (id, cap, over = {}) => ({
  id,
  name: id,
  roleId: "teacher",
  capOverride: cap,
  qualifications: ["A"],
  ...over,
});
const group = (id, periods = 6, teachersNeeded = 1) => ({
  id,
  level: 3,
  block: "A",
  label: id,
  periods,
  teachersNeeded,
  subjectId: "A",
});
const school = (teachers, groups) => ({
  roles,
  teachers,
  groups,
  assignments: [],
});

test("equal caps share the seats evenly", () => {
  const ideals = idealClassCounts(
    school(
      [teacher("a", 60), teacher("b", 60)],
      [1, 2, 3, 4].map((i) => group(`g${i}`)),
    ),
  );
  assert.equal(ideals.get("a"), 2);
  assert.equal(ideals.get("b"), 2);
});

test("unequal caps follow cap share", () => {
  const ideals = idealClassCounts(
    school(
      [teacher("a", 60), teacher("b", 30)],
      [1, 2, 3, 4, 5, 6].map((i) => group(`g${i}`)),
    ),
  );
  assert.equal(ideals.get("a"), 4);
  assert.equal(ideals.get("b"), 2);
});

test("a fill-to-cap role is pulled toward its cap; the rest share what is left", () => {
  // 8 groups x 6 periods: avgP 6. HOD cap 18 -> 3 classes; the other teacher gets 5.
  const ideals = idealClassCounts(
    school(
      [teacher("h", 18, { roleId: "hod" }), teacher("a", 100)],
      [1, 2, 3, 4, 5, 6, 7, 8].map((i) => group(`g${i}`)),
    ),
  );
  assert.equal(ideals.get("h"), 3);
  assert.equal(ideals.get("a"), 5);
});

test("a typed target wins over everything and the rest share the remainder", () => {
  const ideals = idealClassCounts(
    school(
      [
        teacher("a", 100),
        teacher("b", 100, { targetClasses: 1 }),
        teacher("h", 18, { roleId: "hod", targetClasses: 0 }),
      ],
      [1, 2, 3, 4].map((i) => group(`g${i}`)),
    ),
  );
  assert.equal(ideals.get("b"), 1);
  assert.equal(ideals.get("h"), 0);
  assert.equal(ideals.get("a"), 3);
});

test("a team-taught group counts as one seat per teacher", () => {
  const ideals = idealClassCounts(
    school(
      [teacher("a", 60), teacher("b", 60)],
      [group("g1", 6, 2), group("g2", 6, 2)],
    ),
  );
  assert.equal(ideals.get("a") + ideals.get("b"), 4);
});

test("degenerate input gives finite numbers, never NaN or a throw", () => {
  assert.equal(idealClassCounts({}).size, 0);
  assert.equal(idealClassCounts(school([], [group("g1")])).size, 0);
  assert.equal(idealClassCounts(school([teacher("a", 60)], [])).size, 0); // no seats
  // Placeholder, no-cap and unqualified teachers are left out.
  const d = school(
    [
      teacher("a", 60),
      teacher("p", 60, { isPlaceholder: true }),
      teacher("n", null),
      teacher("u", 60, { qualifications: ["B"] }),
    ],
    [group("g1"), group("g2")],
  );
  const ideals = idealClassCounts(d);
  assert.deepEqual([...ideals.keys()], ["a"]);
  assert.equal(ideals.get("a"), 2);
  // Every teacher fill-to-cap and more than the seats: finite, the remainder floors at 0.
  const all = idealClassCounts(
    school(
      [
        teacher("h1", 600, { roleId: "hod" }),
        teacher("h2", 600, { roleId: "hod" }),
      ],
      [group("g1"), group("g2")],
    ),
  );
  for (const v of all.values()) assert.ok(Number.isFinite(v) && v >= 0);
});
