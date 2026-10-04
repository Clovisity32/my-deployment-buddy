import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KINDS,
  HEADERS,
  normalize,
  templateRows,
  rowsFromPaste,
  parseIntake,
  describeAccepted,
  clearIntake,
  countIntake,
} from "../../src/intake.js";
import { validate } from "../../src/data.js";

const school = () => ({
  roles: [{ id: "r", name: "R", maxPeriods: 100 }],
  subjects: [
    {
      id: "G1_LSS",
      name: "G1 LSS",
      discipline: "LSS",
      stream: "G1",
      periods: 12,
      levels: [1, 2],
    },
    {
      id: "G3_SCI_CHEM",
      name: "G3 SCI CHEM",
      discipline: "CHEM",
      stream: "G3",
      periods: 6,
      levels: [3, 4],
    },
  ],
  classes: [
    { id: "101", level: 1, name: "Curiosity" },
    { id: "301", level: 3, name: "Curiosity" },
    { id: "302", level: 3, name: "Respect" },
  ],
  teachers: [
    { id: "t1", name: "Amy Lim", roleId: "r", qualifications: ["G1_LSS"] },
    { id: "t2", name: "Ben Ong", roleId: "r", qualifications: ["G3_SCI_CHEM"] },
    { id: "t3", name: "Amy Tan", roleId: "r", qualifications: [] },
  ],
  groups: [],
  assignments: [],
});

test("normalize() lower-cases and drops punctuation", () => {
  assert.equal(normalize("  Mdm. Amy-Lim "), "mdm amy lim");
});

test("every kind has headers and a template with an example", () => {
  for (const kind of KINDS) {
    const t = templateRows(kind, school());
    assert.deepEqual(t.headers, HEADERS[kind]);
    assert.equal(t.example.length, t.headers.length);
    assert.deepEqual(t.current, []);
  }
});

test("a template is pre-filled with what is already saved, so it can be edited and re-uploaded", () => {
  const d = school();
  d.classes[0].formTeacherId = "t1";
  d.teachers[1].denies = [{ level: 1, stream: "G2" }];
  d.lastYear = [
    { level: 1, classRef: "101", subjectId: "G1_LSS", teacherId: "t1" },
  ];
  assert.deepEqual(templateRows("formTeachers", d).current, [
    ["101", "Amy Lim"],
  ]);
  assert.deepEqual(templateRows("denies", d).current, [
    ["Ben Ong", 1, "G2", ""],
  ]);
  assert.deepEqual(templateRows("lastYear", d).current, [
    [1, "101", "G1_LSS", "Amy Lim"],
  ]);
});

test("rowsFromPaste() copes with CRLF, a pasted header, blank lines and stray spaces", () => {
  const clean = rowsFromPaste("formTeachers", "101\tAmy Lim\n301\tBen Ong");
  const messy = rowsFromPaste(
    "formTeachers",
    "Class\tForm teacher\r\n 101 \t Amy Lim \r\n\r\n301\tBen Ong\r\n\r\n",
  );
  assert.deepEqual(messy, clean);
  assert.deepEqual(clean, [
    { Class: "101", "Form teacher": "Amy Lim" },
    { Class: "301", "Form teacher": "Ben Ong" },
  ]);
  assert.deepEqual(rowsFromPaste("denies", ""), []);
});

test("formTeachers: matches by class id and teacher name, ignoring titles and case", () => {
  const r = parseIntake(
    "formTeachers",
    [
      { Class: "302", "Form teacher": "mdm amy lim" },
      { Class: "Sec 3 Curiosity", "Form teacher": "Ben" },
    ],
    school(),
  );
  assert.deepEqual(r.problems, []);
  assert.equal(r.next.classes.find((c) => c.id === "302").formTeacherId, "t1");
  assert.equal(r.next.classes.find((c) => c.id === "301").formTeacherId, "t2");
  assert.equal(
    "formTeacherId" in r.next.classes.find((c) => c.id === "101"),
    false,
  );
  assert.deepEqual(validate(r.next), []);
});

test("an ambiguous or unknown name is a problem with a plain message, never a guess", () => {
  const r = parseIntake(
    "formTeachers",
    [
      { Class: "Curiosity", "Form teacher": "Ben Ong" }, // in Sec 1 and Sec 3
      { Class: "302", "Form teacher": "Amy" }, // Amy Lim or Amy Tan
      { Class: "999", "Form teacher": "Ben Ong" },
      { Class: "301", "Form teacher": "Zed" },
      { Class: "301", "Form teacher": "" },
    ],
    school(),
  );
  assert.deepEqual(
    r.problems.map((p) => p.row),
    [2, 3, 4, 5, 6],
  );
  assert.match(r.problems[0].message, /more than one class/);
  assert.match(r.problems[1].message, /more than one teacher/);
  assert.match(r.problems[2].message, /No class matches/);
  assert.match(r.problems[3].message, /No teacher matches/);
  assert.match(r.problems[4].message, /blank/);
  assert.deepEqual(r.accepted, []);
  assert.equal(
    r.next.classes.some((c) => c.formTeacherId),
    false,
  ); // nothing applied
});

test("a class listed twice is a problem", () => {
  const r = parseIntake(
    "formTeachers",
    [
      { Class: "301", "Form teacher": "Ben Ong" },
      { Class: "301", "Form teacher": "Amy Lim" },
    ],
    school(),
  );
  assert.match(r.problems[0].message, /listed twice/);
});

test("lastYear: level, class reference, subject (id or name) and teacher", () => {
  const r = parseIntake(
    "lastYear",
    [
      { Level: "Sec 1", Class: "101", Subject: "G1_LSS", Teacher: "Amy Lim" },
      { Level: 3, Class: "301", Subject: "g3 sci chem", Teacher: "Ben Ong" },
    ],
    school(),
  );
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.next.lastYear, [
    { level: 1, classRef: "101", subjectId: "G1_LSS", teacherId: "t1" },
    { level: 3, classRef: "301", subjectId: "G3_SCI_CHEM", teacherId: "t2" },
  ]);
  const bad = parseIntake(
    "lastYear",
    [{ Level: "x", Class: "", Subject: "nope", Teacher: "Ben" }],
    school(),
  );
  assert.equal(bad.problems.length, 1);
});

test("denies: blank cells mean any; a row with no level, stream or subject is a problem", () => {
  const r = parseIntake(
    "denies",
    [
      { Teacher: "Ben Ong", Level: 1, Stream: "g2", Subject: "" },
      { Teacher: "Ben Ong", Level: "", Stream: "", Subject: "G3 SCI CHEM" },
      { Teacher: "Amy Lim", Level: "", Stream: "", Subject: "" },
      { Teacher: "Amy Lim", Level: 2, Stream: "G9", Subject: "" },
    ],
    school(),
  );
  assert.deepEqual(
    r.problems.map((p) => p.row),
    [4, 5],
  );
  assert.match(r.problems[0].message, /level, stream or subject/);
  assert.match(r.problems[1].message, /stream/i);
  const ok = parseIntake(
    "denies",
    [{ Teacher: "Ben Ong", Level: 1, Stream: "g2", Subject: "" }],
    school(),
  );
  assert.deepEqual(ok.next.teachers.find((t) => t.id === "t2").denies, [
    { level: 1, stream: "G2" },
  ]);
  assert.equal("denies" in ok.next.teachers.find((t) => t.id === "t1"), false);
});

test("blank rows are skipped, an empty upload changes nothing, and the input is never mutated", () => {
  const d = school();
  const before = JSON.stringify(d);
  const r = parseIntake("formTeachers", [{ Class: "", "Form teacher": "" }], d);
  assert.deepEqual(r.accepted, []);
  assert.equal(r.next, d);
  parseIntake("formTeachers", [{ Class: "301", "Form teacher": "Ben Ong" }], d);
  assert.equal(JSON.stringify(d), before);
});

test("describeAccepted() turns accepted values into human labels", () => {
  const d = school();
  const ft = parseIntake(
    "formTeachers",
    [{ Class: "301", "Form teacher": "mdm amy lim" }],
    d,
  );
  assert.deepEqual(describeAccepted("formTeachers", ft.accepted, d), {
    headers: ["Class", "Form teacher"],
    rows: [["Sec 3 Curiosity (301)", "Amy Lim"]],
  });
  const ly = parseIntake(
    "lastYear",
    [{ Level: 3, Class: "301", Subject: "G3_SCI_CHEM", Teacher: "Ben" }],
    d,
  );
  assert.deepEqual(describeAccepted("lastYear", ly.accepted, d).rows, [
    ["3", "301", "G3 SCI CHEM", "Ben Ong"],
  ]);
  const dn = parseIntake(
    "denies",
    [
      { Teacher: "Ben Ong", Level: 1, Stream: "g2", Subject: "" },
      { Teacher: "Amy Lim", Level: "", Stream: "", Subject: "G1_LSS" },
    ],
    d,
  );
  const desc = describeAccepted("denies", dn.accepted, d);
  assert.deepEqual(desc.headers, ["Teacher", "Level", "Stream", "Subject"]);
  assert.deepEqual(desc.rows, [
    ["Ben Ong", "Sec 1", "G2", "any"],
    ["Amy Lim", "any level", "any", "G1 LSS"],
  ]);
  assert.deepEqual(describeAccepted("nope", [], d), { headers: [], rows: [] });
  assert.deepEqual(describeAccepted("denies", null, d).rows, []);
});

test("clearIntake() removes one list, counts it, and returns the same object when there is nothing", () => {
  const d = school();
  d.classes[0].formTeacherId = "t1";
  d.teachers[1].denies = [{ level: 1 }, { stream: "G2" }];
  d.lastYear = [
    { level: 1, classRef: "101", subjectId: "G1_LSS", teacherId: "t1" },
  ];
  const before = JSON.stringify(d);
  assert.equal(countIntake("formTeachers", d), 1);
  assert.equal(countIntake("lastYear", d), 1);
  assert.equal(countIntake("denies", d), 2);

  const a = clearIntake("formTeachers", d);
  assert.equal(a.classes.some((c) => "formTeacherId" in c), false);
  assert.equal(a.lastYear.length, 1);
  const b = clearIntake("lastYear", d);
  assert.equal("lastYear" in b, false);
  const c = clearIntake("denies", d);
  assert.equal(c.teachers.some((x) => "denies" in x), false);
  assert.equal(JSON.stringify(d), before); // never mutated
  assert.deepEqual(validate(a), validate(d));

  for (const kind of KINDS) {
    const empty = clearIntake(kind, school());
    assert.equal(countIntake(kind, empty), 0);
    assert.equal(clearIntake(kind, empty), empty);
  }
  assert.equal(clearIntake("nope", d), d);
});
