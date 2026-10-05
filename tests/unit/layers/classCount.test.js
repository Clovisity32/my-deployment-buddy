import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";
import { fixture, group, teacher, only, QUIET, OFF } from "./rulesFixture.js";

const roles = [
  { id: "r", name: "R", maxPeriods: null },
  { id: "hod", name: "HOD", maxPeriods: null },
];
const groups = (n) =>
  Array.from({ length: n }, (_, i) => group(`g${i + 1}`, "A"));
const count = (result, id) =>
  result.assignments.filter((a) => a.teacherId === id).length;
const run = (opts) =>
  solveModel(buildModel(fixture({ roles, ...opts, ...only("classCount", 5) })));

test("adds hi, lo and near rows per teacher with an ideal, plus continuous near/far deviations", () => {
  const m = buildModel(
    fixture({
      teachers: [teacher("a", ["A"]), teacher("b", ["A"])],
      groups: groups(4),
      ...only("classCount", 5),
    }),
  );
  const names = m.constraints.map((c) => c.name);
  for (const t of ["a", "b"]) {
    assert.ok(names.includes(`classCount_hi_${t}`));
    assert.ok(names.includes(`classCount_lo_${t}`));
    assert.ok(names.includes(`classCount_near_${t}`));
  }
  const near = m.constraints.find((c) => c.name === "classCount_near_a");
  assert.equal(near.op, "<=");
  assert.equal(near.rhs, 1);
  assert.equal(m.extraBinaryVars.length, 0); // deviations stay continuous
  const coef = (prefix) =>
    m.objectiveTerms
      .filter((t) => t.varName.startsWith(prefix))
      .map((t) => t.coef);
  assert.deepEqual(coef("cc_near_"), [256, 256]); // the first class off ideal costs w
  assert.deepEqual(coef("cc_far_"), [512, 512]); // each further class costs 2w
});

test("slack is spread evenly when a fill-to-cap teacher cannot reach a cap-based ideal", async () => {
  // The reviewer's repro: three equal teachers on subject A, a HOD (cap 36)
  // qualified only for the single B group. The old code gave 1/1/4.
  const r = await run({
    roles: [
      { id: "r", name: "R", maxPeriods: 60 },
      { id: "hod", name: "HOD", maxPeriods: 36 },
    ],
    teachers: [
      teacher("a", ["A"], { capOverride: null }),
      teacher("b", ["A"], { capOverride: null }),
      teacher("c", ["A"], { capOverride: null }),
      teacher("h", ["B"], { roleId: "hod", capOverride: null }),
    ],
    groups: [...groups(6), group("B1", "B")],
  });
  assert.ok(r.optimal);
  assert.deepEqual(
    ["a", "b", "c", "h"].map((id) => count(r, id)),
    [2, 2, 2, 1],
  );
});

test("two weights one step apart favour the higher priority", async () => {
  // 3 big + 3 small groups, two equal teachers: ideal 3 each. A 3/3 split
  // leaves each teacher with an odd count (mix off by 1 each); a 4/2 split
  // gives both a perfect mix but puts both 1 class off ideal.
  const sixGroups = [
    ...[1, 2, 3].map((i) => group(`big${i}`, "A", { periods: 12 })),
    ...[1, 2, 3].map((i) => group(`small${i}`, "A")),
  ];
  const solveWith = (classCount, mix) =>
    solveModel(
      buildModel(
        fixture({
          roles,
          teachers: [teacher("a", ["A"]), teacher("b", ["A"])],
          groups: sixGroups,
          layerSettings: [OFF("preps"), OFF("graduatingSpread")],
          settings: {
            fairness: {
              preset: "custom",
              levels: { classCount, mix, preps: 1, graduating: 1 },
            },
          },
        }),
      ),
    );
  const split = (r) => [count(r, "a"), count(r, "b")].sort();
  const classCountFirst = await solveWith(5, 4);
  assert.ok(classCountFirst.optimal);
  assert.deepEqual(split(classCountFirst), [3, 3]);
  const mixFirst = await solveWith(4, 5);
  assert.ok(mixFirst.optimal);
  assert.deepEqual(split(mixFirst), [2, 4]);
});

test("equal caps give an even split", async () => {
  const r = await run({
    teachers: [teacher("a", ["A"]), teacher("b", ["A"])],
    groups: groups(4),
  });
  assert.ok(r.optimal);
  assert.deepEqual([count(r, "a"), count(r, "b")], [2, 2]);
});

test("unequal caps follow cap share", async () => {
  const r = await run({
    teachers: [
      teacher("a", ["A"], { capOverride: 60 }),
      teacher("b", ["A"], { capOverride: 30 }),
    ],
    groups: groups(6),
  });
  assert.ok(r.optimal);
  assert.deepEqual([count(r, "a"), count(r, "b")], [4, 2]);
});

test("a fill-to-cap role ends near its own cap", async () => {
  const r = await run({
    teachers: [
      teacher("h", ["A"], { roleId: "hod", capOverride: 18 }),
      teacher("a", ["A"]),
    ],
    groups: groups(8),
  });
  assert.ok(r.optimal);
  assert.equal(count(r, "h"), 3); // cap-share alone would give about 1
});

test("a typed target is honoured", async () => {
  const r = await run({
    teachers: [teacher("a", ["A"]), teacher("b", ["A"], { targetClasses: 1 })],
    groups: groups(4),
  });
  assert.ok(r.optimal);
  assert.deepEqual([count(r, "a"), count(r, "b")], [3, 1]);
});

test("a typed target of 0, or one the teacher cannot reach, never makes the model infeasible", async () => {
  const zero = await run({
    teachers: [teacher("a", ["A"]), teacher("b", ["A"], { targetClasses: 0 })],
    groups: groups(4),
  });
  assert.ok(zero.optimal);
  const tooMany = await run({
    teachers: [
      teacher("a", ["A"], { capOverride: 12, targetClasses: 9 }),
      teacher("b", ["A"]),
    ],
    groups: groups(4),
  });
  assert.ok(tooMany.optimal);
});

test("the placeholder never takes classes just to even out real teachers' counts", async () => {
  // Typed targets a:1, b:1 but 4 groups: the real teachers must take 2 each (gap 2),
  // and a placeholder could take the other 2 at 50 each if its weight were not raised.
  // The saved placeholder weight (50) is deliberately set below a class-count gap (256)
  // to prove buildModel ignores it and uses 10x the largest fairness weight.
  const quiet = only("classCount", 5);
  const r = await solveModel(
    buildModel(
      fixture({
        roles,
        teachers: [
          teacher("a", ["A"], { targetClasses: 1 }),
          teacher("b", ["A"], { targetClasses: 1 }),
          teacher("p", ["A"], { isPlaceholder: true }),
        ],
        groups: groups(4),
        settings: quiet.settings,
        layerSettings: [
          ...quiet.layerSettings,
          { id: "placeholder", enabled: true, weight: 50 },
        ],
      }),
    ),
  );
  assert.ok(r.optimal);
  assert.equal(count(r, "p"), 0);
});

test("a disabled classCount layer, placeholders and teachers qualified for no group add no rows", () => {
  const off = buildModel(
    fixture({
      teachers: [teacher("a", ["A"])],
      groups: groups(2),
      layerSettings: [...QUIET],
    }),
  );
  assert.equal(
    off.constraints.filter((c) => c.name.startsWith("classCount_")).length,
    0,
  );
  const ph = buildModel(
    fixture({
      teachers: [
        teacher("a", ["A"]),
        teacher("p", ["A"], { isPlaceholder: true }),
      ],
      groups: groups(2),
      ...only("classCount", 5),
    }),
  );
  assert.equal(
    ph.constraints.some((c) => c.name === "classCount_hi_p"),
    false,
  );
  const unq = buildModel(
    fixture({
      teachers: [teacher("a", ["A"]), teacher("u", ["Z"])],
      groups: groups(2),
      ...only("classCount", 5),
    }),
  );
  assert.equal(
    unq.constraints.some(
      (c) => c.name.startsWith("classCount_") && c.name.endsWith("_u"),
    ),
    false,
  );
  assert.ok(unq.constraints.some((c) => c.name === "classCount_hi_a"));
});
