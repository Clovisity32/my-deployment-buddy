import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { dataToSheets, sheetsToData } from "../../src/excel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplePath = path.join(__dirname, "../../sample/sample.json");

function loadSample() {
  return JSON.parse(readFileSync(samplePath, "utf8"));
}

test("dataToSheets() produces one array per sheet, matching row counts", () => {
  const data = loadSample();
  const sheets = dataToSheets(data);
  assert.equal(sheets.Teachers.length, data.teachers.length);
  assert.equal(sheets.Groups.length, data.groups.length);
  assert.equal(sheets.Layers.length, data.layerSettings.length);
  assert.equal(sheets.Deployment.length, data.assignments.length);
  assert.equal(sheets.Versions.length, data.versions.length);
});

test("dataToSheets() joins a teacher's subjects into a readable, comma-separated cell", () => {
  const data = loadSample();
  const sheets = dataToSheets(data);
  const haziq = sheets.Teachers.find((t) => t.id === "t8");
  assert.equal(haziq.subjects, "LSS, Chem, Phy");
});

test("sheetsToData() round-trips the fictional sample school exactly", () => {
  const data = loadSample();
  const roundTripped = sheetsToData(dataToSheets(data));
  assert.deepEqual(roundTripped, data);
});

test("sheetsToData() round-trips a locked assignment, a null band, and an empty note", () => {
  const data = {
    teachers: [{ id: "t1", name: "Amy", maxPeriods: 20, subjects: ["Chem"] }],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Chem",
        label: "G1",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        category: "G1",
        note: "",
      },
    ],
    assignments: [{ teacherId: "t1", groupId: "g1", locked: true }],
    layerSettings: [{ id: "coverage", enabled: true, weight: 1 }],
    versions: [],
  };
  assert.deepEqual(sheetsToData(dataToSheets(data)), data);
});

test("sheetsToData() round-trips a version snapshot (nested assignments/layerSettings)", () => {
  const data = {
    teachers: [],
    groups: [],
    assignments: [],
    layerSettings: [],
    versions: [
      {
        name: "Before Mr Tan's request",
        timestamp: "2026-01-01T00:00:00.000Z",
        assignments: [{ teacherId: "t1", groupId: "g1", locked: false }],
        layerSettings: [{ id: "stable", enabled: true, weight: 5 }],
      },
    ],
  };
  assert.deepEqual(sheetsToData(dataToSheets(data)), data);
});

test("sheetsToData() tolerates the loose typing a real spreadsheet round-trip can introduce", () => {
  // XLSX read-back can hand us strings/numbers in slightly different shapes
  // than what we wrote (e.g. a boolean cell typed by the user as text).
  const sheets = {
    Teachers: [
      {
        id: "t1",
        name: "Amy",
        maxPeriods: "20",
        subjects: "Chem, Phy",
        isPlaceholder: "FALSE",
      },
    ],
    Groups: [
      {
        id: "g1",
        level: "3",
        block: "Chem",
        label: "G1",
        periods: "4",
        band: "",
        teachersNeeded: "1",
        category: "",
        note: "",
      },
    ],
    Layers: [{ id: "coverage", enabled: "TRUE", weight: "1" }],
    Deployment: [{ teacherId: "t1", groupId: "g1", locked: "TRUE" }],
    Versions: [],
  };
  const data = sheetsToData(sheets);
  assert.deepEqual(data.teachers, [
    { id: "t1", name: "Amy", maxPeriods: 20, subjects: ["Chem", "Phy"] },
  ]);
  assert.deepEqual(data.groups, [
    {
      id: "g1",
      level: 3,
      block: "Chem",
      label: "G1",
      periods: 4,
      band: null,
      teachersNeeded: 1,
      category: "",
      note: "",
    },
  ]);
  assert.deepEqual(data.layerSettings, [
    { id: "coverage", enabled: true, weight: 1 },
  ]);
  assert.deepEqual(data.assignments, [
    { teacherId: "t1", groupId: "g1", locked: true },
  ]);
});

test("sheetsToData() defaults a missing sheet to an empty array rather than throwing", () => {
  assert.deepEqual(sheetsToData({}), {
    teachers: [],
    groups: [],
    assignments: [],
    layerSettings: [],
    versions: [],
  });
});
