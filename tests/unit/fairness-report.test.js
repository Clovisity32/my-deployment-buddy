import { test } from "node:test";
import assert from "node:assert/strict";
import { fairnessReport } from "../../src/fairness.js";

const roles = [{ id: "r", name: "R", maxPeriods: null }];
const teacher = (id, name, over = {}) => ({
  id,
  name,
  roleId: "r",
  capOverride: 100,
  qualifications: ["A"],
  ...over,
});
const group = (id, level, periods = 6, over = {}) => ({
  id,
  level,
  block: "A",
  label: id,
  periods,
  teachersNeeded: 1,
  subjectId: "A",
  stream: "G2",
  ...over,
});
const asg = (teacherId, groupId) => ({ teacherId, groupId, locked: false });
const text = (report, key) => report.find((r) => r.key === key)?.text;

test("no assignments means no report, and bad input never throws", () => {
  assert.deepEqual(
    fairnessReport({
      roles,
      teachers: [teacher("a", "Amy")],
      groups: [group("g1", 3)],
      assignments: [],
    }),
    [],
  );
  assert.deepEqual(fairnessReport({}), []);
  assert.deepEqual(fairnessReport(null), []);
});

test("class count: names the largest gap from ideal", () => {
  const d = {
    roles,
    teachers: [teacher("a", "Amy"), teacher("b", "Ben")],
    groups: [1, 2, 3, 4].map((i) => group(`g${i}`, 3)),
    assignments: [
      asg("a", "g1"),
      asg("a", "g2"),
      asg("a", "g3"),
      asg("b", "g4"),
    ],
  };
  const t = text(fairnessReport(d), "classCount");
  assert.match(t, /Class count/);
  assert.match(t, /Amy/);
  assert.match(t, /\+1/); // 3 classes vs an ideal of 2
});

test("class count: perfectly even says everyone is on their ideal", () => {
  const d = {
    roles,
    teachers: [teacher("a", "Amy"), teacher("b", "Ben")],
    groups: [1, 2].map((i) => group(`g${i}`, 3)),
    assignments: [asg("a", "g1"), asg("b", "g2")],
  };
  assert.match(
    text(fairnessReport(d), "classCount"),
    /everyone is on their ideal/,
  );
});

test("mix: counts teachers more than 1 away from an even big/small split", () => {
  const d = {
    roles,
    teachers: [teacher("a", "Amy"), teacher("b", "Ben")],
    groups: [
      group("big1", 3, 10),
      group("big2", 3, 10),
      group("big3", 3, 10),
      group("s1", 3, 6),
    ],
    assignments: [
      asg("a", "big1"),
      asg("a", "big2"),
      asg("a", "big3"),
      asg("b", "s1"),
    ],
  };
  const t = text(fairnessReport(d), "mix");
  assert.match(t, /1 teacher/);
  assert.match(t, /Amy/);
  const even = {
    ...d,
    groups: [group("big1", 3, 10), group("s1", 3, 6)],
    assignments: [asg("a", "big1"), asg("a", "s1")],
  };
  assert.match(text(fairnessReport(even), "mix"), /every teacher/i);
});

test("preps: the most any teacher holds, by subject, stream and level", () => {
  const d = {
    roles,
    teachers: [teacher("a", "Amy")],
    groups: [group("g3", 3), group("g4", 4), group("g3b", 3)],
    assignments: [asg("a", "g3"), asg("a", "g4"), asg("a", "g3b")],
  };
  const t = text(fairnessReport(d), "preps");
  assert.match(t, /2/);
  assert.match(t, /Amy/);
});

test("graduating: names anyone above the preferred 2", () => {
  const d = {
    roles,
    teachers: [teacher("a", "Amy"), teacher("b", "Ben")],
    groups: [1, 2, 3].map((i) => group(`g${i}`, 4)).concat([group("g9", 4)]),
    assignments: [
      asg("a", "g1"),
      asg("a", "g2"),
      asg("a", "g3"),
      asg("b", "g9"),
    ],
  };
  assert.match(text(fairnessReport(d), "graduating"), /Amy/);
  const calm = { ...d, assignments: [asg("a", "g1"), asg("b", "g2")] };
  assert.match(text(fairnessReport(calm), "graduating"), /nobody is above 2/i);
});

test("placeholder-only assignments and a team-taught group do not crash and are not blamed on a placeholder", () => {
  const d = {
    roles,
    teachers: [
      teacher("a", "Amy"),
      teacher("p", "New Teacher", { isPlaceholder: true }),
    ],
    groups: [group("g1", 3, 6, { teachersNeeded: 2 })],
    assignments: [asg("a", "g1"), asg("p", "g1")],
  };
  const report = fairnessReport(d);
  for (const r of report) assert.equal(r.text.includes("New Teacher"), false);
  const onlyP = { ...d, assignments: [asg("p", "g1")] };
  assert.doesNotThrow(() => fairnessReport(onlyP));
});
