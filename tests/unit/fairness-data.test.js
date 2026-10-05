import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validate,
  FAIRNESS_PRESETS,
  fairnessSettings,
  roleFillsToCap,
} from "../../src/data.js";
import { dataToSheets, sheetsToData } from "../../src/excel.js";

const sample = () => JSON.parse(readFileSync("sample/sample.json", "utf8"));

test("presets match the spec", () => {
  assert.deepEqual(FAIRNESS_PRESETS.classCountFirst, {
    classCount: 5,
    mix: 4,
    preps: 3,
    graduating: 2,
  });
  assert.deepEqual(FAIRNESS_PRESETS.balanced, {
    classCount: 4,
    mix: 4,
    preps: 3,
    graduating: 3,
  });
  assert.deepEqual(FAIRNESS_PRESETS.fewerPreps, {
    classCount: 4,
    mix: 3,
    preps: 5,
    graduating: 2,
  });
});

test("fairnessSettings() defaults to classCountFirst and tolerates nonsense", () => {
  assert.deepEqual(fairnessSettings({}), {
    preset: "classCountFirst",
    levels: FAIRNESS_PRESETS.classCountFirst,
  });
  assert.equal(
    fairnessSettings({ settings: { fairness: { preset: "balanced" } } }).preset,
    "balanced",
  );
  assert.deepEqual(
    fairnessSettings({ settings: { fairness: { preset: "balanced" } } }).levels,
    FAIRNESS_PRESETS.balanced,
  );
  assert.equal(
    fairnessSettings({ settings: { fairness: { preset: "nope" } } }).preset,
    "classCountFirst",
  );
  const custom = fairnessSettings({
    settings: {
      fairness: {
        preset: "custom",
        levels: { classCount: 2, mix: 9, preps: "x" },
      },
    },
  });
  assert.equal(custom.preset, "custom");
  assert.deepEqual(custom.levels, {
    classCount: 2,
    mix: 5,
    preps: 3,
    graduating: 2,
  }); // 9 -> 5; bad/missing -> classCountFirst
});

test("roleFillsToCap() defaults by role id and an explicit value wins", () => {
  assert.equal(roleFillsToCap({ id: "hod" }), true);
  assert.equal(roleFillsToCap({ id: "sh_st" }), true);
  assert.equal(roleFillsToCap({ id: "teacher" }), false);
  assert.equal(roleFillsToCap({ id: "hod", fillToCap: false }), false);
  assert.equal(roleFillsToCap({ id: "teacher", fillToCap: true }), true);
  assert.equal(roleFillsToCap(undefined), false);
});

test("validate() accepts the new fields and old data", () => {
  assert.deepEqual(validate(sample()), []);
  const d = sample();
  d.roles = d.roles.map((r) =>
    r.id === "teacher" ? { ...r, fillToCap: true } : r,
  );
  d.teachers = d.teachers.map((t) =>
    t.id === "t1" ? { ...t, targetClasses: 4 } : t,
  );
  d.settings = {
    fairness: {
      preset: "custom",
      levels: { classCount: 5, mix: 4, preps: 3, graduating: 2 },
    },
  };
  assert.deepEqual(validate(d), []);
});

test("validate() rejects malformed new fields with plain messages", () => {
  const bad = (patch) => validate({ ...sample(), ...patch });
  assert.ok(
    bad({
      roles: [{ id: "r", name: "R", maxPeriods: 1, fillToCap: "yes" }],
    }).some((m) => m.includes("fillToCap")),
  );
  assert.ok(
    bad({ teachers: [{ id: "t", name: "T", targetClasses: -1 }] }).some((m) =>
      m.includes("targetClasses"),
    ),
  );
  assert.ok(
    bad({ settings: { fairness: { preset: "wat" } } }).some((m) =>
      m.includes("settings.fairness.preset"),
    ),
  );
  assert.ok(
    bad({
      settings: { fairness: { preset: "custom", levels: { classCount: 7 } } },
    }).some((m) => m.includes("settings.fairness.levels")),
  );
});

test("the new fields survive an Excel round trip", () => {
  const d = sample();
  d.roles = d.roles.map((r) =>
    r.id === "teacher" ? { ...r, fillToCap: true } : r,
  );
  d.teachers = d.teachers.map((t) =>
    t.id === "t1" ? { ...t, targetClasses: 4 } : t,
  );
  d.settings = {
    fairness: {
      preset: "custom",
      levels: { classCount: 5, mix: 4, preps: 1, graduating: 2 },
    },
  };
  const out = sheetsToData(dataToSheets(d));
  assert.equal(out.roles.find((r) => r.id === "teacher").fillToCap, true);
  assert.equal(out.teachers.find((t) => t.id === "t1").targetClasses, 4);
  assert.deepEqual(out.settings.fairness, d.settings.fairness);
  assert.deepEqual(validate(out), []);
});

test("an old file gains no new keys through an Excel round trip", () => {
  const out = sheetsToData(dataToSheets(sample()));
  assert.equal(
    out.roles.every((r) => !("fillToCap" in r)),
    true,
  );
  assert.equal(
    out.teachers.every((t) => !("targetClasses" in t)),
    true,
  );
  assert.equal(
    out.settings === undefined || !("fairness" in out.settings),
    true,
  );
  // A Roles sheet from before this change has no fillToCap column at all.
  const sheets = dataToSheets(sample());
  sheets.Roles = sheets.Roles.map(({ fillToCap, ...rest }) => rest);
  sheets.Teachers = sheets.Teachers.map(({ targetClasses, ...rest }) => rest);
  const old = sheetsToData(sheets);
  assert.equal(
    old.roles.every((r) => !("fillToCap" in r)),
    true,
  );
  assert.equal(roleFillsToCap(old.roles.find((r) => r.id === "hod")), true);
});

test("only own keys of FAIRNESS_PRESETS are valid preset names", () => {
  const d = sample();
  d.settings = { ...(d.settings || {}), fairness: { preset: "constructor" } };
  assert.equal(fairnessSettings(d).preset, "classCountFirst");
  assert.ok(validate(d).some((e) => e.includes("settings.fairness.preset")));
});
