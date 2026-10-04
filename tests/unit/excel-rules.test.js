import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dataToSheets, sheetsToData } from "../../src/excel.js";
import { validate } from "../../src/data.js";

const sample = () => JSON.parse(readFileSync("sample/sample.json", "utf8"));

function richData() {
  const d = sample();
  d.classes = d.classes.map((c) =>
    c.id === "101" ? { ...c, formTeacherId: "t1" } : c,
  );
  d.teachers = d.teachers.map((t) =>
    t.id === "t2"
      ? {
          ...t,
          denies: [{ level: 1, stream: "G2" }, { subjectId: "G3_SCI_CHEM" }],
        }
      : t,
  );
  d.lastYear = [
    { level: 1, classRef: "101", subjectId: "G1_LSS", teacherId: "t1" },
  ];
  d.settings = {
    bigPeriods: 10,
    graduatingLevels: [4, 5],
    maxGraduating: 3,
    preferGraduating: 2,
  };
  return d;
}

test("the new fields survive an Excel round trip", () => {
  const out = sheetsToData(dataToSheets(richData()));
  assert.equal(out.classes.find((c) => c.id === "101").formTeacherId, "t1");
  assert.deepEqual(out.teachers.find((t) => t.id === "t2").denies, [
    { level: 1, stream: "G2" },
    { subjectId: "G3_SCI_CHEM" },
  ]);
  assert.deepEqual(out.lastYear, richData().lastYear);
  assert.deepEqual(out.settings, richData().settings);
  assert.deepEqual(validate(out), []);
});

// sample.json carries the new fictional fields after this task, so build a
// true "old file" by stripping them again.
function oldSample() {
  const d = sample();
  delete d.lastYear;
  delete d.settings;
  d.classes = d.classes.map(({ formTeacherId, ...c }) => c);
  d.teachers = d.teachers.map(({ denies, ...t }) => t);
  return d;
}

test("an old file gains no new keys through an Excel round trip", () => {
  const out = sheetsToData(dataToSheets(oldSample()));
  assert.equal("lastYear" in out, false);
  assert.equal("settings" in out, false);
  assert.equal(
    out.classes.every((c) => !("formTeacherId" in c)),
    true,
  );
  assert.equal(
    out.teachers.every((t) => !("denies" in t)),
    true,
  );
});

test("the sheets are human-friendly: blank cells, one row per record", () => {
  const sheets = dataToSheets(richData());
  assert.equal(sheets.Classes.find((r) => r.id === "102").formTeacherId, "");
  assert.equal(
    sheets.Teachers.find((r) => r.id === "t2").denies,
    "1:G2:; ::G3_SCI_CHEM",
  );
  assert.equal(sheets.LastYear.length, 1);
  const keys = sheets.Settings.map((r) => r.key).sort();
  assert.deepEqual(keys, [
    "bigPeriods",
    "graduatingLevels",
    "maxGraduating",
    "preferGraduating",
  ]);
});

test("a single graduating level typed into the Settings sheet is read as a list", () => {
  const sheets = dataToSheets(sample());
  sheets.Settings = [{ key: "graduatingLevels", value: 5 }];
  assert.deepEqual(sheetsToData(sheets).settings.graduatingLevels, [5]);
});

test("a deny rule with an unreadable level is skipped, never broadened", () => {
  const sheets = dataToSheets(sample());
  sheets.Teachers = sheets.Teachers.map((r) =>
    r.id === "t2" ? { ...r, denies: "x:G2:; 0:G3:; 2:G2:" } : r,
  );
  const t2 = sheetsToData(sheets).teachers.find((t) => t.id === "t2");
  assert.deepEqual(t2.denies, [{ level: 2, stream: "G2" }]);
});

test("lastYear[].applied round-trips; blank or false reads back as absent", () => {
  const d = richData();
  d.lastYear = [
    { ...d.lastYear[0], applied: true },
    { level: 3, classRef: "301", subjectId: "G3_SCI_CHEM", teacherId: "t1" },
  ];
  const sheets = dataToSheets(d);
  const out = sheetsToData(sheets);
  assert.equal(out.lastYear[0].applied, true);
  assert.equal("applied" in out.lastYear[1], false);
  assert.deepEqual(validate(out), []);
  // a hand-edited / old sheet with no applied column gains no key
  const old = sheets.LastYear.map(({ applied, ...r }) => r);
  assert.equal(
    sheetsToData({ ...sheets, LastYear: old }).lastYear.every(
      (r) => !("applied" in r),
    ),
    true,
  );
});

test("a lower-case stream typed into the Teachers sheet still denies", () => {
  const sheets = dataToSheets(sample());
  sheets.Teachers = sheets.Teachers.map((r) =>
    r.id === "t2" ? { ...r, denies: "1:g2:" } : r,
  );
  const t2 = sheetsToData(sheets).teachers.find((t) => t.id === "t2");
  assert.deepEqual(t2.denies, [{ level: 1, stream: "G2" }]);
});
