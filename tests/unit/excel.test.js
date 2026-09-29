import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  dataToSheets,
  sheetsToData,
  buildDeploymentLayoutRows,
} from "../../src/excel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplePath = path.join(__dirname, "../../sample/sample.json");

function loadSample() {
  return JSON.parse(readFileSync(samplePath, "utf8"));
}

/** A fully-shaped, mostly-empty schema-v2 data object for focused tests. */
function minimalData(overrides = {}) {
  return {
    roles: [],
    subjects: [],
    classes: [],
    bands: [],
    teachers: [],
    groups: [],
    groupOverrides: {},
    customGroups: [],
    assignments: [],
    layerSettings: [],
    versions: [],
    ...overrides,
  };
}

test("dataToSheets() produces one array per sheet, matching row counts", () => {
  const data = loadSample();
  const sheets = dataToSheets(data);
  assert.equal(sheets.Roles.length, data.roles.length);
  assert.equal(sheets.Subjects.length, data.subjects.length);
  assert.equal(sheets.Classes.length, data.classes.length);
  assert.equal(sheets.Bands.length, data.bands.length);
  assert.equal(sheets.Teachers.length, data.teachers.length);
  assert.equal(sheets.Groups.length, data.groups.length);
  assert.equal(
    sheets.GroupOverrides.length,
    Object.keys(data.groupOverrides).length,
  );
  assert.equal(sheets.CustomGroups.length, data.customGroups.length);
  assert.equal(sheets.Layers.length, data.layerSettings.length);
  assert.equal(sheets.Deployment.length, data.assignments.length);
  assert.equal(sheets.Versions.length, data.versions.length);
});

test("dataToSheets() joins a teacher's qualifications into a readable, comma-separated cell", () => {
  const data = loadSample();
  const sheets = dataToSheets(data);
  const haziq = sheets.Teachers.find((t) => t.id === "t8");
  assert.equal(haziq.qualifications, "G3_SCI_PHY, G3_SCI_BIO, G3_SCI_CHEM");
});

test("sheetsToData() round-trips the fictional sample school exactly", () => {
  const data = loadSample();
  const roundTripped = sheetsToData(dataToSheets(data));
  assert.deepEqual(roundTripped, data);
  // Explicit null/"" and {}/undefined checks - a shallow deepEqual could
  // still pass with capOverride coerced to "" or groupOverrides missing.
  const amy = roundTripped.teachers.find((t) => t.id === "t1");
  assert.equal(amy.capOverride, null);
  const irfan = roundTripped.teachers.find((t) => t.id === "t9");
  assert.equal(irfan.capOverride, 20);
  assert.deepEqual(roundTripped.groupOverrides, {});
});

test("sheetsToData() round-trips a locked assignment, a null band, and an empty note", () => {
  const data = minimalData({
    roles: [{ id: "teacher", name: "Teacher", maxPeriods: 60 }],
    teachers: [
      {
        id: "t1",
        name: "Amy",
        roleId: "teacher",
        capOverride: null,
        qualifications: ["G1_SCI_CHEM"],
      },
    ],
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
        subjectId: "G1_SCI_CHEM",
        discipline: "CHEM",
        stream: "G1",
        classIds: ["301"],
        bandId: null,
      },
    ],
    assignments: [{ teacherId: "t1", groupId: "g1", locked: true }],
    layerSettings: [{ id: "coverage", enabled: true, weight: 1 }],
  });
  assert.deepEqual(sheetsToData(dataToSheets(data)), data);
});

test("sheetsToData() round-trips a version snapshot (nested assignments/layerSettings)", () => {
  const data = minimalData({
    versions: [
      {
        name: "Before Mr Tan's request",
        timestamp: "2026-01-01T00:00:00.000Z",
        assignments: [{ teacherId: "t1", groupId: "g1", locked: false }],
        layerSettings: [{ id: "stable", enabled: true, weight: 5 }],
      },
    ],
  });
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
        roleId: "teacher",
        capOverride: "20",
        qualifications: "Chem, Phy",
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
        subjectId: "Chem",
        discipline: "CHEM",
        stream: "G1",
        classIds: "301, 302",
        bandId: "",
      },
    ],
    Layers: [{ id: "coverage", enabled: "TRUE", weight: "1" }],
    Deployment: [{ teacherId: "t1", groupId: "g1", locked: "TRUE" }],
  };
  const data = sheetsToData(sheets);
  assert.deepEqual(data.teachers, [
    {
      id: "t1",
      name: "Amy",
      roleId: "teacher",
      capOverride: 20,
      qualifications: ["Chem", "Phy"],
    },
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
      subjectId: "Chem",
      discipline: "CHEM",
      stream: "G1",
      classIds: ["301", "302"],
      bandId: null,
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
  assert.deepEqual(sheetsToData({}), minimalData());
});

test("sheetsToData()/dataToSheets() round-trip Roles, including the 'Others' null-cap row", () => {
  const data = minimalData({
    roles: [
      { id: "hod", name: "HOD", maxPeriods: 36 },
      { id: "others", name: "Others", maxPeriods: null },
    ],
  });
  const roundTripped = sheetsToData(dataToSheets(data));
  assert.deepEqual(roundTripped.roles, data.roles);
  assert.equal(roundTripped.roles[1].maxPeriods, null);
});

test("sheetsToData()/dataToSheets() round-trip Subjects with multi-level `levels`", () => {
  const data = minimalData({
    subjects: [
      {
        id: "G3_SCI_PHY",
        name: "G3 SCI_PHY",
        discipline: "PHY",
        stream: "G3",
        periods: 6,
        levels: [3, 4, 5],
      },
    ],
  });
  const roundTripped = sheetsToData(dataToSheets(data));
  assert.deepEqual(roundTripped.subjects, data.subjects);
});

test("sheetsToData()/dataToSheets() round-trip Classes", () => {
  const data = minimalData({
    classes: [
      {
        id: "401",
        level: 4,
        name: "Curiosity",
        subjectIds: ["G2_SCI_PHY", "G2_SCI_CHEM"],
      },
    ],
  });
  const roundTripped = sheetsToData(dataToSheets(data));
  assert.deepEqual(roundTripped.classes, data.classes);
});

test("sheetsToData()/dataToSheets() round-trip a multi-subject Band, including the groups:3 case", () => {
  const data = minimalData({
    bands: [
      {
        id: "b-403-405",
        name: "403 - 405",
        classIds: ["403", "404", "405"],
        subjects: [
          { subjectId: "G3_SCI_PHY", groups: 3 },
          { subjectId: "G3_SCI_BIO", groups: 1 },
        ],
        note: "Banded across 403 - 405",
      },
    ],
  });
  const sheets = dataToSheets(data);
  assert.equal(sheets.Bands[0].subjects, "G3_SCI_PHY:3; G3_SCI_BIO:1");
  const roundTripped = sheetsToData(sheets);
  assert.deepEqual(roundTripped.bands, data.bands);
});

test("sheetsToData() tolerates a malformed Bands subjects cell without throwing", () => {
  const sheets = {
    Bands: [
      {
        id: "b1",
        name: "Band 1",
        classIds: "101, 102",
        subjects: "",
        note: "",
      },
      {
        id: "b2",
        name: "Band 2",
        classIds: "201",
        subjects: "G1_LSS:2;;",
        note: "",
      },
      {
        id: "b3",
        name: "Band 3",
        classIds: "301",
        subjects: "garbage",
        note: "",
      },
    ],
  };
  assert.doesNotThrow(() => sheetsToData(sheets));
  const data = sheetsToData(sheets);
  assert.deepEqual(data.bands[0].subjects, []);
  assert.deepEqual(data.bands[1].subjects, [
    { subjectId: "G1_LSS", groups: 2 },
  ]);
  assert.deepEqual(data.bands[2].subjects, []);
});

test("sheetsToData()/dataToSheets() round-trip a partial GroupOverride (only note set)", () => {
  const data = minimalData({
    groupOverrides: {
      g1: { note: "Merged with parallel class" },
    },
  });
  const roundTripped = sheetsToData(dataToSheets(data));
  assert.deepEqual(roundTripped.groupOverrides, data.groupOverrides);
  assert.equal("label" in roundTripped.groupOverrides.g1, false);
  assert.equal("teachersNeeded" in roundTripped.groupOverrides.g1, false);
});

test("sheetsToData()/dataToSheets() round-trip CustomGroups", () => {
  const data = minimalData({
    customGroups: [
      {
        id: "g-custom-enrich",
        level: 4,
        block: "Chem",
        label: "Enrichment: Chem Research Club",
        periods: 4,
        band: null,
        teachersNeeded: 1,
        category: "ENRICH",
        note: "One-off co-curricular group",
        subjectId: "G3_SCI_CHEM",
        discipline: "CHEM",
        stream: "G3",
        classIds: [],
        bandId: null,
      },
    ],
  });
  const roundTripped = sheetsToData(dataToSheets(data));
  assert.deepEqual(roundTripped.customGroups, data.customGroups);
});

test("buildDeploymentLayoutRows() lays out levels, blocks and rows, with '(unassigned)' and ' / '-joined co-teachers", () => {
  const data = {
    teachers: [
      { id: "t1", name: "Amy" },
      { id: "t2", name: "Ben" },
    ],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Phy",
        label: "301 G1 SCI",
        periods: 10,
        band: null,
        teachersNeeded: 1,
        category: "G1",
        note: "",
      },
      {
        id: "g2",
        level: 4,
        block: "Chem",
        label: "401 G2 SCI_CHEM",
        periods: 6,
        band: null,
        teachersNeeded: 2,
        category: "G2",
        note: "Co-taught",
      },
    ],
    assignments: [
      { teacherId: "t1", groupId: "g2", locked: false },
      { teacherId: "t2", groupId: "g2", locked: false },
    ],
  };

  const rows = buildDeploymentLayoutRows(data);

  assert.deepEqual(rows, [
    ["Level 3"],
    ["Group", "Teacher(s)", "Note"],
    ["Phy"],
    ["301 G1 SCI", "(unassigned)", ""],
    [],
    ["Level 4"],
    ["Group", "Teacher(s)", "Note"],
    ["Chem"],
    ["401 G2 SCI_CHEM", "Amy / Ben", "Co-taught"],
  ]);
});
