import { test } from "node:test";
import assert from "node:assert/strict";
import { bigThreshold, DEFAULT_BIG_PERIODS, validate } from "../../src/data.js";
import { groupCountLayer } from "../../src/layers/groupCount.js";
import { mixLayer } from "../../src/layers/mix.js";
import { buildTeacherView } from "../../src/view.js";

test("bigThreshold() defaults to 10 and honours settings.bigPeriods", () => {
  assert.equal(DEFAULT_BIG_PERIODS, 10);
  assert.equal(bigThreshold({}), 10);
  assert.equal(bigThreshold(undefined), 10);
  assert.equal(bigThreshold({ settings: { bigPeriods: 6 } }), 6);
});

test("bigThreshold() ignores a nonsense value", () => {
  assert.equal(bigThreshold({ settings: { bigPeriods: 0 } }), 10);
  assert.equal(bigThreshold({ settings: { bigPeriods: "x" } }), 10);
  assert.equal(bigThreshold({ settings: { bigPeriods: -3 } }), 10);
});

test("validate() rejects a bad settings.bigPeriods, a non-boolean groupsFrozen and manualLabel", () => {
  const base = { teachers: [], groups: [] };
  assert.deepEqual(validate({ ...base, settings: { bigPeriods: 8 } }), []);
  assert.match(
    validate({ ...base, settings: { bigPeriods: 0 } }).join(" "),
    /settings\.bigPeriods/,
  );
  assert.match(
    validate({ ...base, groupsFrozen: "yes" }).join(" "),
    /groupsFrozen/,
  );
  const g = {
    id: "g1",
    level: 1,
    block: "Phy",
    label: "x",
    periods: 4,
    teachersNeeded: 1,
    manualLabel: "no",
  };
  assert.match(
    validate({ teachers: [], groups: [g] }).join(" "),
    /manualLabel/,
  );
});

test("groupCount uses the configured threshold to split big from small", () => {
  const data = {
    teachers: [{ id: "t1", name: "A", bigCount: 1 }],
    groups: [
      { id: "gA", periods: 6 },
      { id: "gB", periods: 4 },
    ],
    settings: { bigPeriods: 6 },
  };
  const rows = [];
  groupCountLayer.build({
    data,
    x: (t, g) => `x_${t}_${g}`,
    addConstraint: (name, terms, op, rhs) =>
      rows.push({ name, terms, op, rhs }),
  });
  const big = rows.find((r) => r.name === "groupCount_big_t1");
  assert.deepEqual(
    big.terms.map((t) => t.varName),
    ["x_t1_gA"],
  );
});

test("layer descriptions quote the configured threshold", () => {
  assert.match(
    mixLayer.describe({ settings: { bigPeriods: 6 } }),
    /6\+ periods/,
  );
  assert.match(mixLayer.describe({}), /10\+ periods/);
  assert.match(
    groupCountLayer.describe({ settings: { bigPeriods: 6 } }),
    /6\+ periods/,
  );
});

test("buildTeacherView() counts big groups with the configured threshold", () => {
  const data = {
    roles: [{ id: "r", name: "R", maxPeriods: 50 }],
    teachers: [{ id: "t1", name: "A", roleId: "r", capOverride: null }],
    groups: [{ id: "g1", label: "G1", periods: 6, block: "Phy" }],
    assignments: [{ teacherId: "t1", groupId: "g1", locked: false }],
  };
  assert.equal(buildTeacherView(data)[0].big, 0);
  const row = buildTeacherView({ ...data, settings: { bigPeriods: 6 } })[0];
  assert.equal(row.big, 1);
  assert.equal(row.small, 0);
});
