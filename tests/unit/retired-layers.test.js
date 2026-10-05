import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getLayers } from "../../src/layers/registry.js";
import { buildModel } from "../../src/model.js";
import { solveModel } from "../../src/solve.js";
import { validate } from "../../src/data.js";
import { dataToSheets, sheetsToData } from "../../src/excel.js";

const sample = () => JSON.parse(readFileSync("sample/sample.json", "utf8"));

test("balance and stable are no longer layers; classCount is", () => {
  const ids = getLayers().map((l) => l.id);
  assert.equal(ids.includes("balance"), false);
  assert.equal(ids.includes("stable"), false);
  assert.ok(ids.includes("classCount"));
});

test("an old saved deployment (legacy balance/stable settings, no fairness setting) still validates, round-trips and solves without anchoring", async () => {
  const d = sample();
  d.layerSettings = [
    ...d.layerSettings.filter((l) => l.id !== "classCount"),
    { id: "balance", enabled: true, weight: 1 },
    { id: "stable", enabled: true, weight: 5 },
  ];
  assert.deepEqual(validate(d), []);
  assert.deepEqual(validate(sheetsToData(dataToSheets(d))), []);
  const model = buildModel(d);
  assert.equal(
    model.constraints.some((c) => c.name.startsWith("balance_")),
    false,
  );
  const r = await solveModel(model);
  assert.ok(r.optimal);
});

test("sample.json lists classCount and neither retired layer", () => {
  const ids = sample().layerSettings.map((l) => l.id);
  assert.ok(ids.includes("classCount"));
  assert.equal(ids.includes("balance"), false);
  assert.equal(ids.includes("stable"), false);
});

test("a re-solve is not anchored to the current assignments", async () => {
  // Two identical teachers; the current deployment gives both groups to a. Only
  // locks may persist now, so with class counts fairness on, the re-solve splits them.
  const d = {
    roles: [{ id: "r", name: "R", maxPeriods: null }],
    subjects: [
      {
        id: "A",
        name: "A",
        discipline: "A",
        stream: "G2",
        periods: 6,
        levels: [3],
      },
    ],
    classes: [],
    bands: [],
    teachers: ["a", "b"].map((id) => ({
      id,
      name: id,
      roleId: "r",
      capOverride: 100,
      qualifications: ["A"],
    })),
    groups: ["g1", "g2"].map((id) => ({
      id,
      level: 3,
      block: "A",
      label: id,
      periods: 6,
      band: null,
      bandId: null,
      teachersNeeded: 1,
      subjectId: "A",
      stream: "G2",
      classIds: [],
    })),
    assignments: [
      { teacherId: "a", groupId: "g1", locked: false },
      { teacherId: "a", groupId: "g2", locked: false },
    ],
    layerSettings: [
      { id: "mix", enabled: false, weight: 0 },
      { id: "preps", enabled: false, weight: 0 },
      { id: "graduatingSpread", enabled: false, weight: 0 },
    ],
  };
  const r = await solveModel(buildModel(d));
  assert.ok(r.optimal);
  assert.equal(r.assignments.filter((x) => x.teacherId === "a").length, 1);
});
