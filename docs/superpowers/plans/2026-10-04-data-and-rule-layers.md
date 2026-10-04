# Data and Rule Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the HOD record form teachers, last year's teachers and a per-teacher deny list (via Excel template, upload or paste), apply continuity as real locks, and have the solver respect deny, form-teacher and graduating-class rules and count preps by level.

**Architecture:** Optional new data fields (`class.formTeacherId`, `teacher.denies`, `data.lastYear`, graduating settings). Three new constraint-layer files in `src/layers/` following the registry recipe (`deny` via `filterPairs`, `formTeacher`, and `graduatingMax` + `graduatingSpread`), a change of the prep key to subject+stream+level, two new pure modules (`src/intake.js` parsing, `src/continuity.js` locking) and a small UI (Intake cards in the Teachers tab, an "Apply continuity" Board button, a team-taught badge).

**Tech Stack:** Native ES modules (no build step), `node --test`, HiGHS WASM (real solver in tests), SheetJS (`window.XLSX`, already vendored), Playwright + Firebase emulators.

**Spec:** `docs/superpowers/specs/2026-10-04-data-and-rule-layers-design.md`

## Plan amendments (decided while reading the code; the spec gets the same notes in Task 12)

1. **`graduating` is two layers**, `graduatingMax` (hard, constraint prefix `graduatingMax_`) and `graduatingSpread` (soft, prefix `graduatingSpread_`). The registry contract gives the Layers tab a weight box only for `soft` layers, and `diagnose.js` relaxes anything under a hard prefix, so a mixed layer would misbehave in both places.
2. **`data.lastYear` rows use `classRef`** (the class cell as typed, e.g. `301` or `Curiosity`) instead of `classSuffix`. Last year's classes no longer exist in `data.classes`, so the reference is resolved when continuity is applied: by id (`301` → level+1, same suffix → `401`), else by unique class name.
3. **Template files** have a `Template` sheet (headers plus the _current_ rows, so edit-and-reupload works) and an `Example` sheet (one fictional row). Upload and paste replace that kind's whole list. **Save stays disabled while any row has a problem**, so nothing is silently dropped.
4. **The Intake cards live at the bottom of the Teachers tab** (static HTML, so a half-typed paste is not wiped by `renderAll`), not in a new tab.
5. **Graduating settings** (`graduatingLevels`, `maxGraduating`, `preferGraduating`) have defaults and are editable in the Excel `Settings` sheet only. There is no UI for them in this piece (YAGNI).
6. **A denied seat placed by hand on the Board shows a warning** instead of being refused (same stance as going over a cap). Solve will not keep it.

## Global Constraints

- No build step: every file under `src/` stays a native ES module (no bundler, no transpiler, no new dependency).
- No real student/teacher data in the repo: templates, `sample/sample.json` and tests use fictional names only.
- Re-opening a saved file or restoring a version never re-solves. Old files without the new fields load unchanged.
- Pure functions are fail-safe: they never throw; invalid input returns the data unchanged plus a reason.
- Constraint names stay `<layerId>_<entityId>` so `src/diagnose.js` can map them back to a sentence.
- Every UI action gives visible feedback; error messages are plain language with a next step.
- User rule: do NOT push, and do not commit without the user's approval of the message. The commit steps below say "propose the commit message and wait for approval".
- Attribution lines for commits are appended per the session's commit-attribution reminder.

## Review Focus

1. **Pasted text from Excel/Windows**: CRLF line endings, trailing blank lines, a header row pasted along with the data, and stray spaces → `rowsFromPaste` must give the same rows as a clean paste (Task 8).
2. **Names**: titles ("Mdm Tan"), first-name-only that matches two teachers, and a class name ("Curiosity") that exists in several levels → a plain-language "matches more than one" message, never a silent guess (Task 8).
3. **Re-applying continuity** after the HOD unlocked or cleared a seat must not lock it again, and a full or unqualified or denied seat is skipped with a reason (Task 9).
4. **Old data**: a file or version with none of the new fields must validate, round-trip through Excel without gaining keys, and build the same model as before (Tasks 1, 2, 6).
5. **Degenerate rules**: a form teacher whose class has no groups (must not make the model infeasible), a placeholder teacher under the graduating cap, and a deny rule with no level/stream/subject (rejected by `validate`, denies nothing in `isDenied`) (Tasks 1, 4, 5).

---

## File Structure

| File                                                                              | Change        | Responsibility                                                                                                |
| --------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/data.js`                                                                     | modify        | `graduatingSettings`, `prepKey`, `isDenied`, `formatDeny`/`parseDeny`, `validate` for the new fields          |
| `src/excel.js`                                                                    | modify        | round-trip the new fields (`LastYear` sheet, `Classes.formTeacherId`, `Teachers.denies`, new `Settings` keys) |
| `src/layers/deny.js`                                                              | create        | hard: remove denied (teacher, group) pairs via `filterPairs`                                                  |
| `src/layers/formTeacher.js`                                                       | create        | hard: form teacher takes ≥1 group of their class                                                              |
| `src/layers/graduatingMax.js`                                                     | create        | hard: ≤ `maxGraduating` graduating groups per teacher                                                         |
| `src/layers/graduatingSpread.js`                                                  | create        | soft: penalise groups above `preferGraduating`                                                                |
| `src/layers/preps.js`, `src/view.js`                                              | modify        | prep = subject + stream + level (shared `prepKey`)                                                            |
| `src/layers/registry.js`                                                          | modify        | register the four layers                                                                                      |
| `src/diagnose.js`                                                                 | modify        | `HARD_PREFIXES`, `explainConstraint`, `preCheck` wording                                                      |
| `src/board.js`                                                                    | modify        | `denied` flag + warning on a seat                                                                             |
| `src/intake.js`                                                                   | create        | pure: templates, paste/sheet rows → matched, validated data                                                   |
| `src/continuity.js`                                                               | create        | pure: `applyContinuity`                                                                                       |
| `src/ui/intake.js`                                                                | create        | Intake cards wiring (download, upload, paste, preview, save)                                                  |
| `src/ui/board.js`, `src/ui.js`, `index.html`                                      | modify        | Apply-continuity button + report, team badge, Intake markup, wiring                                           |
| `sample/sample.json`                                                              | modify        | fictional examples + layer settings                                                                           |
| `tests/unit/layers/rulesFixture.js`                                               | create        | shared fixture helpers for the layer tests                                                                    |
| `tests/unit/*.test.js`, `tests/unit/layers/*.test.js`, `tests/e2e/intake.spec.js` | create/modify | tests per task                                                                                                |
| `CLAUDE.md`, the spec                                                             | modify        | docs (Task 12)                                                                                                |

Run commands (from the repo root, Git Bash): single unit file `node --test tests/unit/<file>.test.js`; full unit run `npm test` (starts the Firestore emulator; needs Java); rules `npm run test:rules`; e2e `npx playwright test` (starts its own server and emulators).

---

### Task 1: Data helpers and validation

**Files:**

- Modify: `src/data.js` (typedefs at lines 5-23; add helpers after `bigThreshold` at ~line 39; `validate` at lines 205-229, 278-316, 402-419; export block at the end)
- Test: `tests/unit/rules-data.test.js` (create)

**Interfaces:**

- Produces (all exported from `src/data.js`):
  - `graduatingSettings(data) → { levels:number[], max:number, prefer:number }` (defaults `[4,5]`, `3`, `2`; `prefer` never exceeds `max`)
  - `prepKey(group) → string`
  - `isDenied(teacher, group) → boolean`
  - `formatDeny(rule) → string` (`"1:G2:"`), `parseDeny(text) → {level?, stream?, subjectId?}`
  - `validate()` accepts and checks `class.formTeacherId`, `teacher.denies`, `data.lastYear`, `settings.graduatingLevels|maxGraduating|preferGraduating`
- Types: `Deny = {level?:number, stream?:string, subjectId?:string}`; `LastYearRow = {level:number, classRef:string, subjectId:string, teacherId:string}`

- [ ] **Step 1: Write the failing test** — create `tests/unit/rules-data.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validate,
  graduatingSettings,
  prepKey,
  isDenied,
  formatDeny,
  parseDeny,
} from "../../src/data.js";

const base = () => ({
  teachers: [{ id: "t1", name: "Amy" }],
  groups: [],
  assignments: [],
});

test("graduatingSettings() defaults and falls back on nonsense", () => {
  assert.deepEqual(graduatingSettings({}), {
    levels: [4, 5],
    max: 3,
    prefer: 2,
  });
  assert.deepEqual(
    graduatingSettings({
      settings: {
        graduatingLevels: [5],
        maxGraduating: 4,
        preferGraduating: 1,
      },
    }),
    { levels: [5], max: 4, prefer: 1 },
  );
  assert.deepEqual(
    graduatingSettings({
      settings: {
        graduatingLevels: [],
        maxGraduating: -1,
        preferGraduating: "x",
      },
    }),
    { levels: [4, 5], max: 3, prefer: 2 },
  );
  // "prefer" can never be above the hard maximum.
  assert.equal(
    graduatingSettings({ settings: { maxGraduating: 1, preferGraduating: 2 } })
      .prefer,
    1,
  );
});

test("prepKey() separates subject, stream and level", () => {
  const g = { subjectId: "G2_SCI_CHEM", stream: "G2", level: 3 };
  assert.notEqual(prepKey(g), prepKey({ ...g, level: 4 }));
  assert.notEqual(prepKey(g), prepKey({ ...g, subjectId: "G2_SCI_PHY" }));
  assert.equal(prepKey(g), prepKey({ ...g, classIds: ["301"] }));
  // A group with no subjectId falls back to its block.
  assert.notEqual(
    prepKey({ block: "Chem", level: 3 }),
    prepKey({ block: "Phy", level: 3 }),
  );
});

test("isDenied() matches level, stream and subject; a missing part means any", () => {
  const g = { level: 1, stream: "G2", subjectId: "G2_LSS" };
  const t = (denies) => ({ denies });
  assert.equal(isDenied(t([{ level: 1 }]), g), true);
  assert.equal(isDenied(t([{ level: 2 }]), g), false);
  assert.equal(isDenied(t([{ level: 1, stream: "G2" }]), g), true);
  assert.equal(isDenied(t([{ level: 1, stream: "G3" }]), g), false);
  assert.equal(isDenied(t([{ subjectId: "G2_LSS" }]), g), true);
  assert.equal(isDenied(t([{ stream: "G3" }, { level: 1 }]), g), true);
  assert.equal(isDenied({}, g), false);
  assert.equal(isDenied(t([]), g), false);
  // An empty rule would deny everything; it must deny nothing instead.
  assert.equal(isDenied(t([{}]), g), false);
});

test("formatDeny()/parseDeny() round-trip", () => {
  for (const rule of [
    { level: 1, stream: "G2" },
    { level: 3 },
    { stream: "G3", subjectId: "G3_SCI_CHEM" },
    { subjectId: "G1_LSS" },
  ]) {
    assert.deepEqual(parseDeny(formatDeny(rule)), rule);
  }
  assert.equal(formatDeny({ level: 1, stream: "G2" }), "1:G2:");
  assert.deepEqual(parseDeny(" : : "), {});
});

test("validate() accepts old data and the new optional fields", () => {
  assert.deepEqual(validate(base()), []);
  const data = {
    ...base(),
    classes: [{ id: "101", level: 1, name: "Curiosity", formTeacherId: "t1" }],
    teachers: [{ id: "t1", name: "Amy", denies: [{ level: 1, stream: "G2" }] }],
    lastYear: [
      { level: 1, classRef: "101", subjectId: "G1_LSS", teacherId: "t1" },
    ],
    settings: {
      graduatingLevels: [4, 5],
      maxGraduating: 3,
      preferGraduating: 2,
    },
  };
  assert.deepEqual(validate(data), []);
});

test("validate() rejects malformed new fields with plain messages", () => {
  const msgs = (patch) => validate({ ...base(), ...patch });
  assert.ok(
    msgs({
      classes: [{ id: "c", level: 1, name: "X", formTeacherId: 5 }],
    }).some((m) => m.includes("formTeacherId")),
  );
  assert.ok(
    msgs({ teachers: [{ id: "t1", name: "A", denies: "no" }] }).some((m) =>
      m.includes("denies must be an array"),
    ),
  );
  assert.ok(
    msgs({ teachers: [{ id: "t1", name: "A", denies: [{}] }] }).some((m) =>
      m.includes("must name a level, stream or subject"),
    ),
  );
  assert.ok(
    msgs({ teachers: [{ id: "t1", name: "A", denies: [{ level: 0 }] }] }).some(
      (m) => m.includes("denies[0].level"),
    ),
  );
  assert.ok(
    msgs({ lastYear: "x" }).some((m) =>
      m.includes("lastYear must be an array"),
    ),
  );
  assert.ok(
    msgs({
      lastYear: [{ level: 1, classRef: "", subjectId: "s", teacherId: "t1" }],
    }).some((m) => m.includes("lastYear[0].classRef")),
  );
  assert.ok(
    msgs({ settings: { maxGraduating: 1.5 } }).some((m) =>
      m.includes("settings.maxGraduating"),
    ),
  );
  assert.ok(
    msgs({ settings: { maxGraduating: 2, preferGraduating: 3 } }).some((m) =>
      m.includes("preferGraduating"),
    ),
  );
  assert.ok(
    msgs({ settings: { graduatingLevels: ["x"] } }).some((m) =>
      m.includes("settings.graduatingLevels"),
    ),
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/rules-data.test.js`
Expected: FAIL (`graduatingSettings` is not exported from `src/data.js`).

- [ ] **Step 3: Implement.** In `src/data.js`:

(a) Extend the typedefs (keep every existing field; add the new ones):

```js
/** @typedef {{level?:number, stream?:string, subjectId?:string}} Deny */
/** @typedef {{level:number, classRef:string, subjectId:string, teacherId:string}} LastYearRow */
```

and add `formTeacherId?:string|null` to the `SchoolClass` typedef, `denies?:Deny[]` to the `Teacher` typedef.

(b) After `bigThreshold` (line ~39) add:

```js
const DEFAULT_GRADUATING_LEVELS = [4, 5];
const DEFAULT_MAX_GRADUATING = 3;
const DEFAULT_PREFER_GRADUATING = 2;

/** @param {any} v @param {number} fallback */
function wholeOr(v, fallback) {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : fallback;
}

/**
 * Which levels count as graduating, the hard maximum per teacher and the
 * number the solver should aim for. Anything missing or nonsensical falls
 * back to the defaults so old files behave exactly as before.
 * @param {any} data
 * @returns {{levels:number[], max:number, prefer:number}}
 */
function graduatingSettings(data) {
  const s = data?.settings || {};
  const levels =
    Array.isArray(s.graduatingLevels) &&
    s.graduatingLevels.length > 0 &&
    s.graduatingLevels.every((n) => Number.isInteger(n) && n >= 1)
      ? s.graduatingLevels
      : DEFAULT_GRADUATING_LEVELS;
  const max = wholeOr(s.maxGraduating, DEFAULT_MAX_GRADUATING);
  const prefer = Math.min(
    wholeOr(s.preferGraduating, DEFAULT_PREFER_GRADUATING),
    max,
  );
  return { levels, max, prefer };
}

/**
 * What counts as one "prep": the same subject, stream and level. Two Sec 3
 * Chem groups are one prep; Sec 3 Chem and Sec 4 Chem are two.
 * @param {any} g
 * @returns {string}
 */
function prepKey(g) {
  return `${g?.subjectId || g?.block || ""}|${g?.stream || ""}|${g?.level ?? ""}`;
}

/**
 * Is this teacher barred from this group by one of their deny rules? A rule
 * is {level?, stream?, subjectId?}; a missing part means "any". A rule that
 * names nothing denies nothing (never "everything").
 * @param {any} teacher
 * @param {any} group
 * @returns {boolean}
 */
function isDenied(teacher, group) {
  const rules = Array.isArray(teacher?.denies) ? teacher.denies : [];
  return rules.some((r) => {
    if (!r || typeof r !== "object") return false;
    const hasLevel = r.level !== undefined && r.level !== null;
    if (!hasLevel && !r.stream && !r.subjectId) return false;
    return (
      (!hasLevel || r.level === group?.level) &&
      (!r.stream || r.stream === group?.stream) &&
      (!r.subjectId || r.subjectId === group?.subjectId)
    );
  });
}

/** @param {Deny} rule @returns {string} "level:stream:subjectId", blanks allowed */
function formatDeny(rule) {
  return `${rule.level ?? ""}:${rule.stream ?? ""}:${rule.subjectId ?? ""}`;
}

/** @param {string} text @returns {Deny} the inverse of formatDeny() */
function parseDeny(text) {
  const [level = "", stream = "", subjectId = ""] = String(text)
    .split(":")
    .map((s) => s.trim());
  /** @type {Deny} */
  const rule = {};
  const n = Number(level);
  if (level !== "" && Number.isInteger(n) && n >= 1) rule.level = n;
  if (stream) rule.stream = stream;
  if (subjectId) rule.subjectId = subjectId;
  return rule;
}
```

(c) In `validate()`, inside the `classes.forEach` block, after the `subjectIds` check add:

```js
if (
  typeof c.formTeacherId !== "undefined" &&
  c.formTeacherId !== null &&
  typeof c.formTeacherId !== "string"
)
  errors.push(`classes[${i}].formTeacherId must be a teacher id or null.`);
```

(d) Inside `teachers.forEach`, after the `for (const field of [...])` loop add:

```js
if (typeof t.denies !== "undefined") {
  if (!Array.isArray(t.denies)) {
    errors.push(`teachers[${i}].denies must be an array.`);
  } else {
    t.denies.forEach((r, j) => {
      const p = `teachers[${i}].denies[${j}]`;
      if (!r || typeof r !== "object") {
        errors.push(`${p} must be an object.`);
        return;
      }
      const hasLevel = r.level !== undefined && r.level !== null;
      if (hasLevel && !(Number.isInteger(r.level) && r.level >= 1))
        errors.push(`${p}.level must be a whole number of 1 or more.`);
      if (typeof r.stream !== "undefined" && typeof r.stream !== "string")
        errors.push(`${p}.stream must be a string.`);
      if (typeof r.subjectId !== "undefined" && typeof r.subjectId !== "string")
        errors.push(`${p}.subjectId must be a string.`);
      if (!hasLevel && !r.stream && !r.subjectId)
        errors.push(`${p} must name a level, stream or subject.`);
    });
  }
}
```

(e) Replace the `settings` block (lines ~402-419, from `if (typeof data.settings !== "undefined") {` through its closing `}`) with:

```js
if (typeof data.settings !== "undefined") {
  const s = data.settings;
  if (!s || typeof s !== "object" || Array.isArray(s)) {
    errors.push("settings must be an object.");
  } else {
    if (
      typeof s.bigPeriods !== "undefined" &&
      !(Number.isInteger(s.bigPeriods) && s.bigPeriods >= 1)
    )
      errors.push("settings.bigPeriods must be a whole number of 1 or more.");
    if (
      typeof s.graduatingLevels !== "undefined" &&
      !(
        Array.isArray(s.graduatingLevels) &&
        s.graduatingLevels.every((n) => Number.isInteger(n) && n >= 1)
      )
    )
      errors.push(
        "settings.graduatingLevels must be a list of whole level numbers.",
      );
    for (const field of ["maxGraduating", "preferGraduating"]) {
      if (
        typeof s[field] !== "undefined" &&
        !(Number.isInteger(s[field]) && s[field] >= 0)
      )
        errors.push(`settings.${field} must be a whole number of 0 or more.`);
    }
    if (
      Number.isInteger(s.maxGraduating) &&
      Number.isInteger(s.preferGraduating) &&
      s.preferGraduating > s.maxGraduating
    )
      errors.push(
        "settings.preferGraduating cannot be more than settings.maxGraduating.",
      );
  }
}

if (typeof data.lastYear !== "undefined") {
  if (!Array.isArray(data.lastYear)) {
    errors.push("lastYear must be an array.");
  } else {
    data.lastYear.forEach((r, i) => {
      const p = `lastYear[${i}]`;
      if (!r || typeof r !== "object") {
        errors.push(`${p} must be an object.`);
        return;
      }
      if (!(Number.isInteger(r.level) && r.level >= 1))
        errors.push(`${p}.level must be a whole number of 1 or more.`);
      for (const f of ["classRef", "subjectId", "teacherId"])
        if (typeof r[f] !== "string" || r[f].trim() === "")
          errors.push(`${p}.${f} must be a non-empty string.`);
    });
  }
}
```

(f) Add to the export block: `graduatingSettings, prepKey, isDenied, formatDeny, parseDeny,`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/unit/rules-data.test.js tests/unit/data.test.js tests/unit/settings.test.js`
Expected: all PASS (the existing data/settings tests prove old data is unaffected).

- [ ] **Step 5: Commit** — propose `feat(data): add form teacher, deny list, last-year and graduating fields` and wait for approval; then `git add src/data.js tests/unit/rules-data.test.js && git commit`.

---

### Task 2: Excel round-trip and sample data

**Files:**

- Modify: `src/excel.js` (`dataToSheets` lines 105-186, `sheetsToData` lines 228-339, JSDoc at 97-104 and 219-225)
- Modify: `sample/sample.json`
- Test: `tests/unit/excel-rules.test.js` (create)

**Interfaces:**

- Consumes: `formatDeny`, `parseDeny` from Task 1.
- Produces: `dataToSheets` gains sheet `LastYear` (`level, classRef, subjectId, teacherId`), column `formTeacherId` on `Classes`, column `denies` on `Teachers` (`"1:G2:; :G3:G3_SCI_CHEM"`), and `Settings` keys `graduatingLevels`, `maxGraduating`, `preferGraduating`. `sheetsToData` reads them back and adds a key only when it has content.

- [ ] **Step 1: Write the failing test** — create `tests/unit/excel-rules.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/excel-rules.test.js`
Expected: FAIL (`formTeacherId` undefined after the round trip).

- [ ] **Step 3: Implement** in `src/excel.js`:

(a) Import: `import { formatDeny, parseDeny } from "./data.js";` (add next to the existing imports at the top; `excel.js` currently imports only `buildDeploymentView`).

(b) In `dataToSheets`: change the `Classes` mapper to add `formTeacherId: c.formTeacherId ?? "",`; the `Teachers` mapper to add `denies: (t.denies || []).map(formatDeny).join("; "),` after `maxGroups`; add `LastYear` after `Deployment`:

```js
    LastYear: (data.lastYear || []).map((r) => ({
      level: r.level,
      classRef: r.classRef,
      subjectId: r.subjectId,
      teacherId: r.teacherId,
    })),
```

and extend the `Settings` array (after the `bigPeriods` entry):

```js
      ...(data.settings && data.settings.graduatingLevels !== undefined
        ? [{ key: "graduatingLevels", value: (data.settings.graduatingLevels || []).join(SUBJECT_SEPARATOR) }]
        : []),
      ...(data.settings && data.settings.maxGraduating !== undefined
        ? [{ key: "maxGraduating", value: data.settings.maxGraduating }]
        : []),
      ...(data.settings && data.settings.preferGraduating !== undefined
        ? [{ key: "preferGraduating", value: data.settings.preferGraduating }]
        : []),
```

Add `LastYear:object[]` to the return-type JSDoc above `dataToSheets` and to the `sheetsToData` param JSDoc.

(c) In `sheetsToData`: in the `classes` mapper add `...(row.formTeacherId ? { formTeacherId: String(row.formTeacherId) } : {}),`; in the `teachers` mapper add (after the three `optionalCount` spreads):

```js
    ...denyField(row.denies),
```

add the helper next to `optionalCount`:

```js
// "1:G2:; ::G3_SCI_CHEM" -> [{level:1, stream:"G2"}, {subjectId:"G3_SCI_CHEM"}].
// No rules means no field, so an old file round-trips unchanged.
function denyField(cell) {
  const rules = String(cell ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseDeny)
    .filter((r) => r.level !== undefined || r.stream || r.subjectId);
  return rules.length > 0 ? { denies: rules } : {};
}
```

then build `lastYear` and the settings object. Replace the final `return {...}` settings spreads (the `frozen` and `bigPeriods` handling) with:

```js
const lastYear = (sheets.LastYear || [])
  .filter((row) => row.classRef !== "" && row.classRef != null)
  .map((row) => ({
    level: toNumber(row.level),
    classRef: String(row.classRef).trim(),
    subjectId: String(row.subjectId),
    teacherId: String(row.teacherId),
  }));

const settings = {};
if (bigPeriods !== undefined && bigPeriods !== "")
  settings.bigPeriods = toNumber(bigPeriods);
const gradLevels = setting("graduatingLevels");
if (gradLevels !== undefined && gradLevels !== "")
  settings.graduatingLevels = splitList(gradLevels)
    .map(Number)
    .filter((n) => Number.isFinite(n));
for (const key of ["maxGraduating", "preferGraduating"]) {
  const v = setting(key);
  if (v !== undefined && v !== "") settings[key] = toNumber(v);
}

return {
  roles,
  subjects,
  classes,
  bands,
  teachers,
  groups,
  groupOverrides,
  customGroups,
  assignments,
  layerSettings,
  versions,
  ...(frozen === undefined || frozen === ""
    ? {}
    : { groupsFrozen: toBool(frozen) }),
  ...(lastYear.length > 0 ? { lastYear } : {}),
  ...(Object.keys(settings).length > 0 ? { settings } : {}),
};
```

(d) `sample/sample.json` (fictional only). Add `"formTeacherId": "t1"` to the class with id `"101"`; add `"denies": [{ "level": 4 }]` to teacher `t9` (Irfan, qualified only for `G1_LSS`, a Sec 1-2 subject, so the rule is inert for existing solves); add a top-level `"lastYear": [{ "level": 1, "classRef": "101", "subjectId": "G1_LSS", "teacherId": "t1" }]`. (Layer settings are added in Task 7.)

- [ ] **Step 4: Run to verify it passes, then the neighbours**

Run: `node --test tests/unit/excel-rules.test.js tests/unit/excel.test.js tests/unit/data.test.js`
Expected: PASS. If `excel.test.js` has a hard-coded expectation about the sample's key set or sheet names, update that expectation to include the new sheet/keys (they are the only intended change).

- [ ] **Step 5: Commit** — propose `feat(excel): round-trip form teachers, deny list, last-year teachers and graduating settings`; wait for approval.

---

### Task 3: `deny` layer, Board warning, diagnose wording

**Files:**

- Create: `src/layers/deny.js`, `tests/unit/layers/rulesFixture.js`, `tests/unit/layers/deny.test.js`, `tests/unit/board-deny.test.js`
- Modify: `src/layers/registry.js`, `src/board.js` (seat object ~line 166, warnings ~line 183), `src/diagnose.js` (message at line 36)

**Interfaces:**

- Consumes: `isDenied` (Task 1).
- Produces: layer id `deny` (hard, structural: `filterPairs` only); `rulesFixture.js` exports `OFF, ON, QUIET, group, teacher, fixture` used by Tasks 4-6; board seats gain `denied:boolean`.

- [ ] **Step 1: Create the shared fixture** `tests/unit/layers/rulesFixture.js`:

```js
// Shared by the new-rule layer tests. Groups default to Sec 3, stream G2,
// 6 periods, one teacher needed; teachers default to a 100-period cap.
export const OFF = (id) => ({ id, enabled: false, weight: 0 });
export const ON = (id, weight) => ({ id, enabled: true, weight });
// Soft layers that would otherwise pull the answer around in a test.
export const QUIET = [OFF("balance"), OFF("mix"), OFF("preps"), OFF("stable")];

export function group(id, subjectId, over = {}) {
  return {
    id,
    level: 3,
    block: subjectId,
    label: id,
    periods: 6,
    band: null,
    bandId: null,
    teachersNeeded: 1,
    subjectId,
    stream: "G2",
    classIds: [],
    ...over,
  };
}

export const teacher = (id, quals, over = {}) => ({
  id,
  name: id,
  roleId: "r",
  capOverride: 100,
  qualifications: quals,
  ...over,
});

export function fixture({
  teachers,
  groups,
  classes = [],
  layerSettings = QUIET,
  assignments = [],
  settings,
}) {
  const subjectIds = [...new Set(groups.map((g) => g.subjectId))];
  return {
    roles: [{ id: "r", name: "R", maxPeriods: null }],
    subjects: subjectIds.map((id) => ({
      id,
      name: id,
      discipline: id,
      stream: "G2",
      periods: 6,
      levels: [3],
    })),
    classes,
    bands: [],
    teachers,
    groups,
    assignments,
    layerSettings,
    ...(settings ? { settings } : {}),
  };
}
```

- [ ] **Step 2: Write the failing tests** — `tests/unit/layers/deny.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";
import { preCheck } from "../../../src/diagnose.js";
import { fixture, group, teacher, QUIET, OFF } from "./rulesFixture.js";

const data = (denies, layerSettings = QUIET) =>
  fixture({
    teachers: [teacher("t1", ["A"], { denies }), teacher("t2", ["A"])],
    groups: [
      group("g1", "A", { level: 1 }),
      group("g3", "A", { level: 3, stream: "G3" }),
    ],
    layerSettings,
  });
const has = (m, t, g) =>
  m.pairs.some((p) => p.teacherId === t && p.groupId === g);

test("deny removes a denied (teacher, group) pair before any variable exists", () => {
  const m = buildModel(data([{ level: 1 }]));
  assert.equal(has(m, "t1", "g1"), false);
  assert.equal(has(m, "t1", "g3"), true);
  assert.equal(has(m, "t2", "g1"), true);
});

test("a rule can name a stream or a subject", () => {
  assert.equal(has(buildModel(data([{ stream: "G3" }])), "t1", "g3"), false);
  assert.equal(has(buildModel(data([{ subjectId: "A" }])), "t1", "g1"), false);
  assert.equal(has(buildModel(data([{ subjectId: "B" }])), "t1", "g1"), true);
});

test("the solver gives a denied group to someone else", async () => {
  const result = await solveModel(buildModel(data([{ level: 1 }])));
  assert.ok(result.optimal);
  assert.equal(
    result.assignments.find((a) => a.groupId === "g1").teacherId,
    "t2",
  );
});

test("no denies, an empty rule, or a disabled layer keeps every pair", () => {
  for (const m of [
    buildModel(data(undefined)),
    buildModel(data([{}])),
    buildModel(data([{ level: 1 }], [...QUIET, OFF("deny")])),
  ]) {
    assert.equal(m.pairs.length, 4);
  }
});

test("preCheck says so when every qualified teacher is denied a group", () => {
  const d = fixture({
    teachers: [teacher("t1", ["A"], { denies: [{ level: 1 }] })],
    groups: [group("g1", "A", { level: 1 })],
  });
  const issues = preCheck(d, buildModel(d));
  assert.ok(
    issues.some((i) => i.includes("deny list")),
    issues.join("|"),
  );
});
```

`tests/unit/board-deny.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../../src/board.js";

test("a seat held by a denied teacher is flagged and warned about", () => {
  const data = {
    roles: [{ id: "r", name: "R", maxPeriods: 100 }],
    teachers: [
      {
        id: "t1",
        name: "Amy",
        roleId: "r",
        qualifications: ["A"],
        denies: [{ level: 3 }],
      },
    ],
    groups: [
      {
        id: "g1",
        level: 3,
        block: "A",
        label: "g1",
        periods: 6,
        teachersNeeded: 1,
        subjectId: "A",
        stream: "G2",
        classIds: [],
      },
    ],
    assignments: [{ groupId: "g1", teacherId: "t1", locked: false }],
  };
  const row = buildBoard(data).sections[0].cards[0].rows[0];
  assert.equal(row.seats[0].denied, true);
  assert.ok(
    row.warnings.some((w) => w.includes("deny list")),
    row.warnings.join("|"),
  );
  const ok = buildBoard({
    ...data,
    teachers: [{ ...data.teachers[0], denies: [] }],
  });
  assert.equal(ok.sections[0].cards[0].rows[0].seats[0].denied, false);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test tests/unit/layers/deny.test.js tests/unit/board-deny.test.js`
Expected: FAIL (pairs are not removed; `denied` is undefined).

- [ ] **Step 4: Implement.**

`src/layers/deny.js`:

```js
// L-deny (hard): a teacher is never given a group that matches one of their
// deny rules (a level, a stream and/or a subject, e.g. "not Sec 1 G2").
// Structural, like qualification.js: filterPairs() removes the pair before
// any variable exists, so it adds no rows and keeps the model small.
// To relax a rule, delete it from the teacher's list.

import { isDenied } from "../data.js";

const denyLayer = {
  id: "deny",
  name: "Deny list",
  kind: "hard",
  defaultWeight: 0,
  describe(data) {
    const n = (data.teachers || []).reduce(
      (sum, t) => sum + (Array.isArray(t.denies) ? t.denies.length : 0),
      0,
    );
    return n > 0
      ? `${n} deny rule(s): those teachers are never given the groups they are barred from.`
      : "Teachers can be barred from certain levels, streams or subjects (none set yet).";
  },
  filterPairs(data, pairs) {
    const teacherById = new Map(data.teachers.map((t) => [t.id, t]));
    const groupById = new Map(data.groups.map((g) => [g.id, g]));
    return pairs.filter(({ teacherId, groupId }) => {
      const t = teacherById.get(teacherId);
      const g = groupById.get(groupId);
      return !(t && g && isDenied(t, g));
    });
  },
  build() {
    // No-op - see filterPairs() above.
  },
};

export { denyLayer };
```

`src/layers/registry.js`: add `import { denyLayer } from "./deny.js";` and put `denyLayer,` right after `qualificationLayer,` in `LAYERS`.

`src/board.js`: change the import to `import { bigThreshold, isDenied } from "./data.js";`; in the seat object (line ~166-173) add `denied: t ? isDenied(t, g) : false,`; in the warnings loop after the `!s.qualified` line add:

```js
if (s.denied)
  warnings.push(
    `${s.teacherName} is on the deny list for this group, so Solve will not keep this placement.`,
  );
```

`src/diagnose.js` line 36: replace the message with
`` `No teacher is qualified for "${g.label}" (${g.block}), or every qualified teacher is on a deny list for it. Add a qualified teacher, check a teacher's subject list isn't missing ${g.block}, or relax a deny rule.` ``

- [ ] **Step 5: Run to verify they pass, plus the suite slice**

Run: `node --test tests/unit/layers/deny.test.js tests/unit/board-deny.test.js tests/unit/board.test.js tests/unit/diagnose.test.js tests/unit/model.test.js`
Expected: PASS. If an existing test counts layers or lists the model's layer ids, update the expected list to include `deny` (the only intended change).

- [ ] **Step 6: Commit** — propose `feat(layers): add deny list layer with Board warning`; wait for approval.

---

### Task 4: `formTeacher` layer

**Files:**

- Create: `src/layers/formTeacher.js`, `tests/unit/layers/formTeacher.test.js`
- Modify: `src/layers/registry.js`, `src/diagnose.js` (`HARD_PREFIXES` at line 157, `explainConstraint` before the final `return` at line 374)

**Interfaces:**

- Consumes: `fixture/group/teacher/QUIET` (Task 3); `class.formTeacherId`.
- Produces: layer `formTeacher` (hard), constraint `formTeacher_<classId>`: `Σ x(formTeacher, g) ≥ 1` over groups whose `classIds` include the class. A class with no groups at all is skipped.

- [ ] **Step 1: Write the failing test** `tests/unit/layers/formTeacher.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";
import {
  diagnoseInfeasibility,
  explainConstraint,
} from "../../../src/diagnose.js";
import { fixture, group, teacher, QUIET, OFF } from "./rulesFixture.js";

const cls = (id, formTeacherId) => ({ id, level: 3, name: id, formTeacherId });

// Two 6-period groups, two teachers with room for exactly one group each.
function twoByTwo(formTeacherId, layerSettings = QUIET) {
  return fixture({
    classes: [cls("c1", formTeacherId), cls("c2", null)],
    teachers: [
      teacher("t1", ["A"], { capOverride: 6 }),
      teacher("t2", ["A"], { capOverride: 6 }),
    ],
    groups: [
      group("g1", "A", { classIds: ["c1"] }),
      group("g2", "A", { classIds: ["c2"] }),
    ],
    layerSettings,
  });
}

test("adds one >= 1 row per class with a form teacher", () => {
  const m = buildModel(twoByTwo("t1"));
  const rows = m.constraints.filter((c) => c.name.startsWith("formTeacher_"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "formTeacher_c1");
  assert.equal(rows[0].op, ">=");
  assert.equal(rows[0].rhs, 1);
  assert.equal(rows[0].terms.length, 1); // only t1 x g1: g2 is not their class
});

test("the form teacher ends up teaching their own class", async () => {
  const result = await solveModel(buildModel(twoByTwo("t1")));
  assert.ok(result.optimal);
  assert.equal(
    result.assignments.find((a) => a.groupId === "g1").teacherId,
    "t1",
  );
  const other = await solveModel(buildModel(twoByTwo("t2")));
  assert.equal(
    other.assignments.find((a) => a.groupId === "g1").teacherId,
    "t2",
  );
});

test("no form teachers, an unknown teacher, a class with no groups, or a disabled layer add nothing", () => {
  const none = (d) =>
    buildModel(d).constraints.filter((c) => c.name.startsWith("formTeacher_"))
      .length;
  assert.equal(none(twoByTwo(null)), 0);
  assert.equal(none(twoByTwo("ghost")), 0);
  const d = twoByTwo("t1");
  d.classes.push(cls("c9", "t1")); // no group contains c9
  assert.equal(none(d), 1);
  assert.equal(none(twoByTwo("t1", [...QUIET, OFF("formTeacher")])), 0);
});

test("a form teacher who cannot teach any group of the class makes it infeasible, and says why", async () => {
  const d = fixture({
    classes: [cls("c1", "t1")],
    teachers: [teacher("t1", ["A"]), teacher("t2", ["B"])],
    groups: [group("g1", "B", { classIds: ["c1"] })],
  });
  const model = buildModel(d);
  assert.equal((await solveModel(model)).optimal, false);
  const { issues } = await diagnoseInfeasibility(d, model);
  assert.ok(
    issues.some((i) => i.includes("form teacher") && i.includes("t1")),
    issues.join("|"),
  );
});

test("explainConstraint() names the teacher and the class", () => {
  const d = twoByTwo("t1");
  d.teachers[0].name = "Amy";
  d.classes[0].name = "Curiosity";
  const msg = explainConstraint("formTeacher_c1", d, 1);
  assert.match(msg, /Amy/);
  assert.match(msg, /Sec 3 Curiosity/);
  assert.match(msg, /form teacher/);
  assert.match(explainConstraint("formTeacher_nope", d, 1), /form teacher/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/layers/formTeacher.test.js`
Expected: FAIL (no `formTeacher_` rows).

- [ ] **Step 3: Implement.**

`src/layers/formTeacher.js`:

```js
// L-formTeacher (hard): the form teacher of a class must teach at least one
// group that contains that class (any subject they are qualified for). A
// class with no group at all is skipped - there is nothing to teach - and a
// form teacher who can't teach any of the class's groups leaves an empty row
// on purpose, so the model is infeasible and diagnose.js can say why.

const formTeacherLayer = {
  id: "formTeacher",
  name: "Form teachers teach their class",
  kind: "hard",
  defaultWeight: 0,
  describe(data) {
    const n = (data.classes || []).filter((c) => c.formTeacherId).length;
    return n > 0
      ? `${n} form teacher(s) must teach at least one group that includes their form class.`
      : "A form teacher must teach their form class (no form teachers set yet).";
  },
  build(ctx) {
    const teacherIds = new Set(ctx.data.teachers.map((t) => t.id));
    for (const c of ctx.data.classes || []) {
      if (!c.formTeacherId || !teacherIds.has(c.formTeacherId)) continue;
      const classGroups = ctx.data.groups.filter(
        (g) => Array.isArray(g.classIds) && g.classIds.includes(c.id),
      );
      if (classGroups.length === 0) continue;
      const terms = [];
      for (const g of classGroups) {
        const varName = ctx.x(c.formTeacherId, g.id);
        if (varName) terms.push({ coef: 1, varName });
      }
      ctx.addConstraint(`formTeacher_${c.id}`, terms, ">=", 1);
    }
  },
};

export { formTeacherLayer };
```

`registry.js`: import and add `formTeacherLayer,` right after `pinLayer,`.

`diagnose.js`: add `"formTeacher_",` to `HARD_PREFIXES`; before the final `return` in `explainConstraint` add:

```js
if (constraintName.startsWith("formTeacher_")) {
  // Name is "formTeacher_<classId>"; the id may contain underscores, so
  // match it against the real class list.
  const classId = constraintName.slice("formTeacher_".length);
  const c = (data.classes || []).find((x) => x.id === classId);
  const t = c && teacherById.get(c.formTeacherId);
  return c && t
    ? `"${t.name}" is form teacher of Sec ${c.level} ${c.name} but can't be given any group of that class - they may not be qualified for them, may be on a deny list for them, or the other requirements leave no room. Change the form teacher or relax a rule.`
    : "A form teacher could not be given any group of their own class. Change the form teacher or relax a rule.";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/unit/layers/formTeacher.test.js tests/unit/diagnose.test.js tests/unit/model.test.js`
Expected: PASS (update a layer-id/ordering expectation in `model.test.js` only if one exists).

- [ ] **Step 5: Commit** — propose `feat(layers): add form teacher layer`; wait for approval.

---

### Task 5: Graduating layers (hard maximum + soft spread)

**Files:**

- Create: `src/layers/graduatingMax.js`, `src/layers/graduatingSpread.js`, `tests/unit/layers/graduating.test.js`
- Modify: `src/layers/registry.js`, `src/diagnose.js`

**Interfaces:**

- Consumes: `graduatingSettings` (Task 1), fixtures (Task 3).
- Produces: `graduatingMax` (hard): `graduatingMax_<teacherId>`: `Σ x ≤ max` over groups in `levels`; `graduatingSpread` (soft, default weight 1): `graduatingSpread_<teacherId>`: `Σ x − over ≤ prefer`, objective `weight × over`. Placeholder teachers are skipped in both. A team-taught group counts once per teacher (one variable per pair).

- [ ] **Step 1: Write the failing test** `tests/unit/layers/graduating.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";
import { explainConstraint } from "../../../src/diagnose.js";
import { fixture, group, teacher, QUIET, ON, OFF } from "./rulesFixture.js";

// Four Sec 4 groups and two Sec 2 groups, two teachers who can teach any.
function data({ settings, layerSettings = QUIET, teachers } = {}) {
  return fixture({
    teachers: teachers ?? [teacher("t1", ["A"]), teacher("t2", ["A"])],
    groups: [
      ...[1, 2, 3, 4].map((i) => group(`g4${i}`, "A", { level: 4 })),
      ...[1, 2].map((i) => group(`g2${i}`, "A", { level: 2 })),
    ],
    layerSettings,
    settings,
  });
}
const gradCount = (result, tid) =>
  result.assignments.filter(
    (a) => a.teacherId === tid && a.groupId.startsWith("g4"),
  ).length;

test("graduatingMax caps each teacher at the maximum (default 3)", () => {
  const rows = buildModel(data()).constraints.filter((c) =>
    c.name.startsWith("graduatingMax_"),
  );
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every((r) => r.op === "<=" && r.rhs === 3 && r.terms.length === 4),
  );
});

test("with one teacher, 4 graduating groups are infeasible under a hard max of 3", async () => {
  const d = data({ teachers: [teacher("t1", ["A"])] });
  assert.equal((await solveModel(buildModel(d))).optimal, false);
});

test("the maximum and the levels come from settings", () => {
  const rows = buildModel(
    data({ settings: { maxGraduating: 1, graduatingLevels: [2] } }),
  ).constraints.filter((c) => c.name.startsWith("graduatingMax_"));
  assert.equal(rows.length, 2); // one row per teacher: 2 Sec 2 groups > a maximum of 1
  assert.ok(rows.every((r) => r.rhs === 1 && r.terms.length === 2)); // only the two Sec 2 groups
});

test("graduatingSpread spreads them 2 + 2 instead of 3 + 1 or 4 + 0", async () => {
  const d = data({ layerSettings: [...QUIET, ON("graduatingSpread", 5)] });
  const r = await solveModel(buildModel(d));
  assert.ok(r.optimal);
  assert.deepEqual([gradCount(r, "t1"), gradCount(r, "t2")], [2, 2]);
});

test("graduatingSpread only goes above the preferred 2 when it has to", async () => {
  const d = data({
    teachers: [
      teacher("t1", ["A"]),
      teacher("t2", ["A"]),
      teacher("t3", ["A"]),
    ],
    layerSettings: [...QUIET, ON("graduatingSpread", 5)],
  });
  const r = await solveModel(buildModel(d));
  for (const t of ["t1", "t2", "t3"])
    assert.ok(gradCount(r, t) <= 2, `${t} has ${gradCount(r, t)}`);
});

test("placeholder teachers are not capped, and disabled layers add nothing", () => {
  const d = data({
    teachers: [
      teacher("t1", ["A"]),
      teacher("ph", ["A"], { isPlaceholder: true }),
    ],
  });
  const names = buildModel(d).constraints.map((c) => c.name);
  assert.equal(
    names.some((n) => n === "graduatingMax_ph"),
    false,
  );
  const off = buildModel(
    data({
      layerSettings: [...QUIET, OFF("graduatingMax"), OFF("graduatingSpread")],
    }),
  );
  assert.equal(
    off.constraints.filter((c) => c.name.startsWith("graduating")).length,
    0,
  );
});

test("explainConstraint() explains a graduating-max clash in plain language", () => {
  const d = data();
  d.teachers[0].name = "Amy";
  const msg = explainConstraint("graduatingMax_t1", d, 1);
  assert.match(msg, /Amy/);
  assert.match(msg, /graduating/);
  assert.match(msg, /3/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/layers/graduating.test.js`
Expected: FAIL (no `graduatingMax_` rows).

- [ ] **Step 3: Implement.**

`src/layers/graduatingMax.js`:

```js
// L-graduatingMax (hard): no teacher takes more than the maximum number of
// graduating groups (default Sec 4 and Sec 5, at most 3). Counted in groups,
// once per teacher, so a team-taught group counts as one for each teacher.
// Placeholder teachers are left out - they exist to absorb a shortage.

import { graduatingSettings } from "../data.js";

const graduatingMaxLayer = {
  id: "graduatingMax",
  name: "Graduating classes: hard maximum",
  kind: "hard",
  defaultWeight: 0,
  describe(data) {
    const { levels, max } = graduatingSettings(data);
    return `No teacher takes more than ${max} graduating group(s) (Sec ${levels.join("/")}).`;
  },
  build(ctx) {
    const { levels, max } = graduatingSettings(ctx.data);
    for (const t of ctx.data.teachers) {
      if (t.isPlaceholder) continue;
      const terms = [];
      for (const g of ctx.data.groups) {
        if (!levels.includes(g.level)) continue;
        const varName = ctx.x(t.id, g.id);
        if (varName) terms.push({ coef: 1, varName });
      }
      if (terms.length > max) {
        ctx.addConstraint(`graduatingMax_${t.id}`, terms, "<=", max);
      }
    }
  },
};

export { graduatingMaxLayer };
```

`src/layers/graduatingSpread.js`:

```js
// L-graduatingSpread (soft): revision season is intense, so aim for no more
// than the preferred number of graduating groups (default 2) per teacher.
// Each group above that costs `weight`. The over_<n> variables are not
// declared Binary, so they stay continuous and >= 0 (same as mix.js).

import { graduatingSettings } from "../data.js";

const graduatingSpreadLayer = {
  id: "graduatingSpread",
  name: "Spread graduating classes",
  kind: "soft",
  defaultWeight: 1,
  describe(data) {
    const { levels, prefer } = graduatingSettings(data);
    return `Aim for at most ${prefer} graduating group(s) (Sec ${levels.join("/")}) per teacher; each extra one is penalised.`;
  },
  build(ctx) {
    const weight = ctx.weight("graduatingSpread");
    if (!weight) return;
    const { levels, prefer } = graduatingSettings(ctx.data);
    let n = 0;
    for (const t of ctx.data.teachers) {
      if (t.isPlaceholder) continue;
      const terms = [];
      for (const g of ctx.data.groups) {
        if (!levels.includes(g.level)) continue;
        const varName = ctx.x(t.id, g.id);
        if (varName) terms.push({ coef: 1, varName });
      }
      if (terms.length <= prefer) continue; // can never go over
      const over = `grad_over_${n++}`;
      ctx.addConstraint(
        `graduatingSpread_${t.id}`,
        [...terms, { coef: -1, varName: over }],
        "<=",
        prefer,
      );
      ctx.addObjectiveTerm(weight, over);
    }
  },
};

export { graduatingSpreadLayer };
```

`registry.js`: import both; add `graduatingMaxLayer,` right after `groupCountLayer,` and `graduatingSpreadLayer,` right after `mixLayer,`.

`diagnose.js`: add `"graduatingMax_",` to `HARD_PREFIXES` (NOT `graduatingSpread_`: the soft row must never be relaxed); add to `explainConstraint`, before the final `return`:

```js
if (constraintName.startsWith("graduatingMax_")) {
  const t = teacherById.get(constraintName.slice("graduatingMax_".length));
  const { max } = graduatingSettings(data);
  return t
    ? `"${t.name}" would need ${rounded} more graduating group(s) than the maximum of ${max} to satisfy the other requirements (often caused by locked assignments). Unlock one, or move a graduating class to someone else.`
    : "A teacher's maximum of graduating groups could not be respected.";
}
```

and extend the import at line 13: `import { effectiveCap, bigThreshold, graduatingSettings } from "./data.js";`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/unit/layers/graduating.test.js tests/unit/diagnose.test.js tests/unit/model.test.js tests/unit/solve.test.js`
Expected: PASS. (`solve.test.js` and the model tests run the real sample; level 4/5 groups there must still solve. If the sample becomes infeasible because one teacher would exceed 3 graduating groups, that is a genuine finding: report it to the user rather than raising the maximum.)

- [ ] **Step 5: Commit** — propose `feat(layers): add graduating maximum and spread layers`; wait for approval.

---

### Task 6: Preps count subject + stream + level

**Files:**

- Modify: `src/layers/preps.js` (lines 1-3, 22, 30), `src/view.js` (line 200, 205, JSDoc line 173)
- Test: `tests/unit/layers/preps-level.test.js` (create); `tests/unit/view.test.js` (add a case after line 420)

**Interfaces:**

- Consumes: `prepKey` (Task 1).
- Produces: prep binaries are keyed by `prepKey(g)`; `buildTeacherView().preps` counts distinct `prepKey`s so the tally agrees with the solver.

- [ ] **Step 1: Write the failing tests** `tests/unit/layers/preps-level.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../../../src/model.js";
import { solveModel } from "../../../src/solve.js";
import { prepKey } from "../../../src/data.js";
import { fixture, group, teacher, OFF, ON } from "./rulesFixture.js";

// Same subject at two levels: Sec 3 twice, Sec 4 twice.
const d = () =>
  fixture({
    // maxGroups 2 each (hard) forces a 2 + 2 split; without it "t1 takes all four"
    // ties with "one level each" and the solve assertion below would be a coin toss.
    teachers: [
      teacher("t1", ["A"], { maxGroups: 2 }),
      teacher("t2", ["A"], { maxGroups: 2 }),
    ],
    groups: [
      group("a3x", "A", { level: 3 }),
      group("a3y", "A", { level: 3 }),
      group("a4x", "A", { level: 4 }),
      group("a4y", "A", { level: 4 }),
    ],
    layerSettings: [OFF("balance"), OFF("mix"), OFF("stable"), ON("preps", 2)],
  });

test("a prep is subject + stream + level: 2 teachers x 2 levels = 4 prep switches", () => {
  assert.equal(buildModel(d()).extraBinaryVars.length, 4);
});

test("preps pushes each teacher to a single level of the same subject", async () => {
  const data = d();
  const result = await solveModel(buildModel(data));
  assert.ok(result.optimal);
  const groupById = new Map(data.groups.map((g) => [g.id, g]));
  const preps = new Map();
  for (const a of result.assignments) {
    if (!preps.has(a.teacherId)) preps.set(a.teacherId, new Set());
    preps.get(a.teacherId).add(prepKey(groupById.get(a.groupId)));
  }
  assert.deepEqual(
    [...preps.values()].map((s) => s.size),
    [1, 1],
  );
});
```

Append to `tests/unit/view.test.js` (it already imports `buildTeacherView`):

```js
test("buildTeacherView() counts the same subject at two levels as two preps", () => {
  const mk = (id, level) => ({
    id,
    level,
    block: "Chem",
    label: id,
    periods: 6,
    teachersNeeded: 1,
    subjectId: "G2_SCI_CHEM",
    stream: "G2",
  });
  const data = {
    roles: [{ id: "teacher", name: "Teacher", maxPeriods: 60 }],
    teachers: [{ id: "a", name: "Ann", roleId: "teacher", capOverride: null }],
    groups: [mk("g1", 3), mk("g2", 3), mk("g3", 4)],
    assignments: [
      { teacherId: "a", groupId: "g1" },
      { teacherId: "a", groupId: "g2" },
      { teacherId: "a", groupId: "g3" },
    ],
  };
  assert.equal(buildTeacherView(data)[0].preps, 2);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/unit/layers/preps-level.test.js tests/unit/view.test.js`
Expected: FAIL (2 prep switches instead of 4; `preps` is 1 instead of 2).

- [ ] **Step 3: Implement.**

`src/layers/preps.js`: add `import { prepKey } from "../data.js";` at the top; update the header comment (lines 1-3) to "A prep is one subject at one level and stream a teacher has at least one group in, e.g. Sec 3 G2 Chem and Sec 4 G2 Chem are two preps."; delete the `const subjectOf = ...` line (22) and replace `const s = subjectOf(g);` (30) with `const s = prepKey(g);`.

`src/view.js`: import `prepKey` alongside the existing `bigThreshold, effectiveCap` import from `./data.js`; in the `teacherGroups` map replace `subject: g.subjectId || g.block,` with `prep: prepKey(g),`; replace line 205 with `const preps = new Set(teacherGroups.map((g) => g.prep)).size;`; update the JSDoc line 173 to "preps = distinct subject + stream + level".
(If another file reads `groups[].subject` from `buildTeacherView`, `grep -rn "\.subject\b" src` will show it; keep a `subject` field next to `prep` in that case.)

- [ ] **Step 4: Run to verify they pass, then everything that touches preps/tally**

Run: `node --test tests/unit/layers/preps-level.test.js tests/unit/layers/mix-preps.test.js tests/unit/view.test.js tests/unit/board.test.js`
Expected: PASS (the existing preps tests use one level, so their numbers are unchanged).

- [ ] **Step 5: Commit** — propose `feat(preps): count a prep as subject + stream + level`; wait for approval.

---

### Task 7: Sample layer settings and a full-suite checkpoint

**Files:**

- Modify: `sample/sample.json` (`layerSettings`)
- Modify: any test that hard-codes the layer list (found by running the suite)

**Interfaces:** Produces `layerSettings` entries `deny`, `formTeacher`, `graduatingMax` (enabled, weight 1) and `graduatingSpread` (enabled, weight 1) so the Layers tab shows sensible defaults (CLAUDE.md "add a layer" step 4).

- [ ] **Step 1: Add the entries** to `layerSettings` in `sample/sample.json`:

```json
{ "id": "deny", "enabled": true, "weight": 1 },
{ "id": "formTeacher", "enabled": true, "weight": 1 },
{ "id": "graduatingMax", "enabled": true, "weight": 1 },
{ "id": "graduatingSpread", "enabled": true, "weight": 1 }
```

- [ ] **Step 2: Run the full unit suite**

Run: `npm test`
Expected: all PASS (was 207; now 207 + the new tests). If `tests/unit/excel.test.js:51`-style assertions compare against `data.layerSettings.length`, they adapt automatically. If a test asserts a fixed list of layer ids, add the four new ids in registry order (deny after qualification, formTeacher after pin, graduatingMax after groupCount, graduatingSpread after mix).

- [ ] **Step 3: Run the rules and e2e suites** (nothing in this task should change them; this proves the sample still loads, solves and displays)

Run: `npm run test:rules` then `npx playwright test`
Expected: 4/4 and 35/35 PASS. If an e2e solve now fails because of `formTeacherId: "t1"` on class 101 or the graduating maximum, read the failure: the sample is fictional, so adjust the sample (e.g. choose a different form teacher), never the rules.

- [ ] **Step 4: Commit** — propose `chore(sample): add fictional examples and layer defaults for the new rules`; wait for approval.

---

### Task 8: `src/intake.js` (templates, paste, matching, parsing)

**Files:**

- Create: `src/intake.js`, `tests/unit/intake.test.js`

**Interfaces:**

- Produces (exported): `KINDS`, `HEADERS`, `normalize(text)`, `templateRows(kind, data) → {headers:string[], current:any[][], example:any[]}`, `rowsFromPaste(kind, text) → object[]`, `parseIntake(kind, rows, data) → { accepted:object[], problems:{row:number, message:string}[], next:object }`. `kind` is `"formTeachers" | "lastYear" | "denies"`. `rows` are objects keyed by the header names (case-insensitive). `next` is the new data (the unchanged `data` when there are problems or no rows). Uploading replaces that kind's whole list.

- [ ] **Step 1: Write the failing test** `tests/unit/intake.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KINDS,
  HEADERS,
  normalize,
  templateRows,
  rowsFromPaste,
  parseIntake,
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/intake.test.js`
Expected: FAIL (cannot find module `src/intake.js`).

- [ ] **Step 3: Implement `src/intake.js`:**

```js
// Intake: turns the three Excel inputs (form teachers, last year's teachers,
// per-teacher deny list) into validated data. Pure and fail-safe: nothing
// here touches the browser, and a bad row becomes a plain-language problem
// instead of an exception. Pasted text and uploaded files both become rows
// keyed by header name first, so they share one code path (parseIntake).

const KINDS = ["formTeachers", "lastYear", "denies"];

const HEADERS = {
  formTeachers: ["Class", "Form teacher"],
  lastYear: ["Level", "Class", "Subject", "Teacher"],
  denies: ["Teacher", "Level", "Stream", "Subject"],
};

// Fictional, clearly-not-real example rows for the template's Example sheet.
const EXAMPLES = {
  formTeachers: ["301", "Alex Example"],
  lastYear: [3, "301", "G3_SCI_CHEM", "Alex Example"],
  denies: ["Alex Example", 1, "G2", ""],
};

const STREAMS = ["G1", "G2", "G3", "PURE"];
const TITLES = new Set([
  "mr",
  "mrs",
  "ms",
  "mdm",
  "madam",
  "miss",
  "dr",
  "mister",
]);

/** @param {any} text */
function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const compact = (text) => normalize(text).replace(/ /g, "");
const nameTokens = (text) =>
  normalize(text)
    .split(" ")
    .filter((t) => t && !TITLES.has(t));

/** The cell under `header`, matched ignoring case/spacing. */
function pick(row, header) {
  const want = normalize(header);
  const key = Object.keys(row || {}).find((k) => normalize(k) === want);
  return key === undefined ? "" : row[key];
}

const isBlank = (v) => String(v ?? "").trim() === "";
const isBlankRow = (row) => Object.values(row || {}).every(isBlank);

function findTeacher(data, text) {
  const q = nameTokens(text);
  if (q.length === 0) return { error: "The teacher name is blank." };
  const teachers = data.teachers || [];
  const exact = teachers.filter(
    (t) => nameTokens(t.name).join(" ") === q.join(" "),
  );
  if (exact.length === 1) return { id: exact[0].id };
  const pool =
    exact.length > 1
      ? exact
      : teachers.filter((t) => {
          const tokens = nameTokens(t.name);
          return q.every((w) => tokens.includes(w));
        });
  if (pool.length === 1) return { id: pool[0].id };
  if (pool.length > 1)
    return {
      error: `"${String(text).trim()}" matches more than one teacher (${pool.map((t) => t.name).join(", ")}). Use the full name.`,
    };
  return {
    error: `No teacher matches "${String(text).trim()}". Check the spelling against the Teachers table.`,
  };
}

function findClass(data, text) {
  const q = compact(text);
  if (q === "") return { error: "The class is blank." };
  const hits = (data.classes || []).filter((c) =>
    [
      c.id,
      c.name,
      `${c.level}${c.name}`,
      `s${c.level}${c.name}`,
      `sec${c.level}${c.name}`,
    ].some((cand) => compact(cand) === q),
  );
  if (hits.length === 1) return { id: hits[0].id };
  if (hits.length > 1)
    return {
      error: `"${String(text).trim()}" matches more than one class - use the class id (e.g. ${hits[0].id}) or "Sec ${hits[0].level} ${hits[0].name}".`,
    };
  return {
    error: `No class matches "${String(text).trim()}". Use a class id or name from the Classes tab.`,
  };
}

function findSubject(data, text) {
  const q = normalize(text);
  if (q === "") return { error: "The subject is blank." };
  const hits = (data.subjects || []).filter(
    (s) => normalize(s.id) === q || normalize(s.name) === q,
  );
  if (hits.length === 1) return { id: hits[0].id };
  return {
    error: `No subject matches "${String(text).trim()}". Use a subject id or name from the Subjects tab.`,
  };
}

/** @returns {{value?:number|undefined, error?:string}} blank is allowed (value undefined) */
function parseLevel(v) {
  if (isBlank(v)) return { value: undefined };
  const n = Number(String(v).replace(/[^0-9]/g, ""));
  if (Number.isInteger(n) && n >= 1 && n <= 9) return { value: n };
  return {
    error: `"${String(v).trim()}" is not a level. Use a number such as 3 or "Sec 3".`,
  };
}

function parseStream(v) {
  if (isBlank(v)) return { value: undefined };
  const s = String(v).trim().toUpperCase();
  return STREAMS.includes(s)
    ? { value: s }
    : {
        error: `"${String(v).trim()}" is not a stream. Use ${STREAMS.join(", ")} or leave it blank.`,
      };
}

const teacherName = (data, id) =>
  (data.teachers || []).find((t) => t.id === id)?.name ?? id;

function templateRows(kind, data) {
  const headers = HEADERS[kind];
  const example = EXAMPLES[kind];
  let current = [];
  if (kind === "formTeachers") {
    current = (data.classes || [])
      .filter((c) => c.formTeacherId)
      .map((c) => [c.id, teacherName(data, c.formTeacherId)]);
  } else if (kind === "lastYear") {
    current = (data.lastYear || []).map((r) => [
      r.level,
      r.classRef,
      r.subjectId,
      teacherName(data, r.teacherId),
    ]);
  } else if (kind === "denies") {
    current = (data.teachers || []).flatMap((t) =>
      (t.denies || []).map((r) => [
        t.name,
        r.level ?? "",
        r.stream ?? "",
        r.subjectId ?? "",
      ]),
    );
  }
  return { headers, current, example };
}

/** Tab-separated text (what Excel copies) -> rows keyed by header name. */
function rowsFromPaste(kind, text) {
  const headers = HEADERS[kind];
  const cells = String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\t").map((c) => c.trim()));
  if (cells.length > 0 && normalize(cells[0][0]) === normalize(headers[0]))
    cells.shift();
  return cells.map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])),
  );
}

const PARSERS = {
  formTeachers(row, data, seen) {
    const c = findClass(data, pick(row, "Class"));
    if (c.error) return { error: c.error };
    const t = findTeacher(data, pick(row, "Form teacher"));
    if (t.error) return { error: t.error };
    if (seen.has(c.id))
      return {
        error: `Class ${c.id} is listed twice. Keep one form teacher per class.`,
      };
    seen.add(c.id);
    return { value: { classId: c.id, teacherId: t.id } };
  },
  lastYear(row, data, seen) {
    const level = parseLevel(pick(row, "Level"));
    if (level.error) return { error: level.error };
    if (level.value === undefined) return { error: "The level is blank." };
    const classRef = String(pick(row, "Class") ?? "").trim();
    if (classRef === "") return { error: "The class is blank." };
    const s = findSubject(data, pick(row, "Subject"));
    if (s.error) return { error: s.error };
    const t = findTeacher(data, pick(row, "Teacher"));
    if (t.error) return { error: t.error };
    const key = `${level.value}|${compact(classRef)}|${s.id}`;
    if (seen.has(key))
      return {
        error: `${classRef} ${s.id} is listed twice. Keep one teacher per class and subject.`,
      };
    seen.add(key);
    return {
      value: { level: level.value, classRef, subjectId: s.id, teacherId: t.id },
    };
  },
  denies(row, data) {
    const t = findTeacher(data, pick(row, "Teacher"));
    if (t.error) return { error: t.error };
    const level = parseLevel(pick(row, "Level"));
    if (level.error) return { error: level.error };
    const stream = parseStream(pick(row, "Stream"));
    if (stream.error) return { error: stream.error };
    let subjectId;
    if (!isBlank(pick(row, "Subject"))) {
      const s = findSubject(data, pick(row, "Subject"));
      if (s.error) return { error: s.error };
      subjectId = s.id;
    }
    if (level.value === undefined && !stream.value && !subjectId)
      return {
        error:
          "Say which level, stream or subject to avoid - a blank rule would block nothing.",
      };
    return {
      value: {
        teacherId: t.id,
        rule: {
          ...(level.value !== undefined ? { level: level.value } : {}),
          ...(stream.value ? { stream: stream.value } : {}),
          ...(subjectId ? { subjectId } : {}),
        },
      },
    };
  },
};

const APPLY = {
  formTeachers(data, accepted) {
    return {
      ...data,
      classes: (data.classes || []).map((c) => {
        const { formTeacherId, ...rest } = c;
        const hit = accepted.find((a) => a.classId === c.id);
        return hit ? { ...rest, formTeacherId: hit.teacherId } : rest;
      }),
    };
  },
  lastYear(data, accepted) {
    return { ...data, lastYear: accepted };
  },
  denies(data, accepted) {
    const byTeacher = new Map();
    for (const a of accepted) {
      if (!byTeacher.has(a.teacherId)) byTeacher.set(a.teacherId, []);
      byTeacher.get(a.teacherId).push(a.rule);
    }
    return {
      ...data,
      teachers: (data.teachers || []).map((t) => {
        const { denies, ...rest } = t;
        const rules = byTeacher.get(t.id);
        return rules ? { ...rest, denies: rules } : rest;
      }),
    };
  },
};

/**
 * @param {"formTeachers"|"lastYear"|"denies"} kind
 * @param {object[]} rows  objects keyed by header name
 * @param {any} data
 * @returns {{accepted:object[], problems:{row:number, message:string}[], next:any}}
 *   `row` is the spreadsheet row number (the header is row 1). `next` is the
 *   updated data, or `data` itself when there are problems or nothing to apply.
 */
function parseIntake(kind, rows, data) {
  const parser = PARSERS[kind];
  const accepted = [];
  const problems = [];
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row, i) => {
    if (isBlankRow(row)) return;
    const res = parser
      ? parser(row, data || {}, seen)
      : { error: "Unknown kind." };
    if (res.error) problems.push({ row: i + 2, message: res.error });
    else accepted.push(res.value);
  });
  const next =
    problems.length > 0 || accepted.length === 0
      ? data
      : APPLY[kind](data, accepted);
  return { accepted, problems, next };
}

export {
  KINDS,
  HEADERS,
  EXAMPLES,
  normalize,
  templateRows,
  rowsFromPaste,
  parseIntake,
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/unit/intake.test.js`
Expected: PASS. (If the "Amy" ambiguity test fails because `findTeacher("Amy")` resolves to one teacher, re-read `nameTokens`: both "Amy Lim" and "Amy Tan" contain the token `amy`, so `pool.length` is 2.)

- [ ] **Step 5: Commit** — propose `feat(intake): add template, paste and name-matching for form teachers, last year and deny list`; wait for approval.

---

### Task 9: `src/continuity.js` (`applyContinuity`)

**Files:**

- Create: `src/continuity.js`, `tests/unit/continuity.test.js`

**Interfaces:**

- Consumes: `normalize` (Task 8), `isDenied` (Task 1), `data.lastYear`.
- Produces: `applyContinuity(data) → { data, added:number, skipped:{message:string}[] }`. Only rows with `level` 1 or 3 are used (target level = level + 1). New assignments are `{teacherId, groupId, locked:true}` appended to `data.assignments`. Existing assignments are never changed, and a teacher already placed on the group (locked or not) is skipped, so a seat the HOD unlocked on purpose is never re-locked.

- [ ] **Step 1: Write the failing test** `tests/unit/continuity.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyContinuity } from "../../src/continuity.js";

const school = () => ({
  roles: [{ id: "r", name: "R", maxPeriods: 100 }],
  classes: [
    { id: "101", level: 1, name: "Curiosity" },
    { id: "201", level: 2, name: "Curiosity" },
    { id: "202", level: 2, name: "Respect" },
    { id: "301", level: 3, name: "Curiosity" },
    { id: "401", level: 4, name: "Curiosity" },
    { id: "501", level: 5, name: "Flourish" },
  ],
  teachers: [
    { id: "t1", name: "Amy Lim", roleId: "r", qualifications: ["LSS", "CHEM"] },
    { id: "t2", name: "Ben Ong", roleId: "r", qualifications: ["LSS"] },
    {
      id: "t3",
      name: "Cat Wee",
      roleId: "r",
      qualifications: ["CHEM"],
      denies: [{ level: 4 }],
    },
  ],
  groups: [
    {
      id: "g201",
      level: 2,
      subjectId: "LSS",
      stream: "G1",
      classIds: ["201", "202"],
      teachersNeeded: 1,
      periods: 6,
      block: "LSS",
      label: "g201",
    },
    {
      id: "g401",
      level: 4,
      subjectId: "CHEM",
      stream: "G3",
      classIds: ["401"],
      teachersNeeded: 1,
      periods: 6,
      block: "CHEM",
      label: "g401",
    },
  ],
  assignments: [],
  lastYear: [],
});
const ly = (level, classRef, subjectId, teacherId) => ({
  level,
  classRef,
  subjectId,
  teacherId,
});

test("Sec 1 -> 2 and Sec 3 -> 4 become locked assignments", () => {
  const d = school();
  d.lastYear = [ly(1, "101", "LSS", "t2"), ly(3, "301", "CHEM", "t1")];
  const r = applyContinuity(d);
  assert.equal(r.added, 2);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.data.assignments, [
    { teacherId: "t2", groupId: "g201", locked: true },
    { teacherId: "t1", groupId: "g401", locked: true },
  ]);
  assert.equal(d.assignments.length, 0); // input untouched
});

test("a class can be given by name when its id doesn't follow level+suffix", () => {
  const d = school();
  d.lastYear = [ly(1, "Respect", "LSS", "t1")]; // Sec 2 Respect = 202, in g201
  assert.equal(applyContinuity(d).added, 1);
});

test("other levels are not locked (Sec 2, Sec 4 and Sec 5 are left to the solver)", () => {
  const d = school();
  d.lastYear = [
    ly(2, "201", "LSS", "t1"),
    ly(4, "401", "CHEM", "t1"),
    ly(5, "501", "CHEM", "t1"),
  ];
  const r = applyContinuity(d);
  assert.equal(r.added, 0);
  assert.equal(r.data, d);
});

test("skips with a reason: unknown class, no such group, unqualified, denied, full", () => {
  const d = school();
  d.assignments = [{ teacherId: "t2", groupId: "g201", locked: false }];
  d.lastYear = [
    ly(1, "199", "LSS", "t1"), // no Sec 2 class matches
    ly(1, "101", "CHEM", "t1"), // Sec 2 has no CHEM group for that class
    ly(3, "301", "CHEM", "t2"), // Ben is not qualified for CHEM
    ly(3, "301", "CHEM", "t3"), // Cat is denied Sec 4
    ly(1, "101", "LSS", "t1"), // g201 already has its teacher (Ben)
  ];
  const r = applyContinuity(d);
  assert.equal(r.added, 0);
  assert.equal(r.skipped.length, 5);
  assert.match(r.skipped[0].message, /no Sec 2 class/i);
  assert.match(r.skipped[1].message, /no group/i);
  assert.match(r.skipped[2].message, /not qualified/i);
  assert.match(r.skipped[3].message, /deny list/i);
  assert.match(r.skipped[4].message, /already/i);
});

test("applying twice never re-locks a seat the HOD unlocked on purpose", () => {
  const d = school();
  d.lastYear = [ly(1, "101", "LSS", "t2")];
  const once = applyContinuity(d);
  const unlocked = {
    ...once.data,
    assignments: once.data.assignments.map((a) => ({ ...a, locked: false })),
  };
  const twice = applyContinuity(unlocked);
  assert.equal(twice.added, 0);
  assert.equal(twice.data.assignments[0].locked, false);
  assert.match(twice.skipped[0].message, /already/i);
});

test("no last-year data, or missing arrays, is harmless", () => {
  assert.equal(applyContinuity({}).added, 0);
  assert.equal(
    applyContinuity({ lastYear: [ly(1, "101", "LSS", "t1")] }).added,
    0,
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/continuity.test.js`
Expected: FAIL (cannot find module `src/continuity.js`).

- [ ] **Step 3: Implement `src/continuity.js`:**

```js
// Continuity: last year's teacher keeps their class for Sec 1 -> 2 and
// Sec 3 -> 4. Applied as ordinary LOCKED assignments, so the solver needs no
// special rule and the HOD unlocks an exception with the Board's lock toggle.
// Pure and fail-safe. Existing assignments are never changed.

import { isDenied } from "./data.js";
import { normalize } from "./intake.js";

const CARRY_OVER_LEVELS = [1, 3];

/** The class this year that last year's class became, or null. */
function targetClass(data, row) {
  const toLevel = row.level + 1;
  const classes = (data.classes || []).filter((c) => c.level === toLevel);
  const ref = String(row.classRef ?? "").trim();
  // Ids look like <level digit><suffix> (301 -> 401): keep the suffix.
  const prefix = String(row.level);
  if (
    /^\d+$/.test(ref) &&
    ref.startsWith(prefix) &&
    ref.length > prefix.length
  ) {
    const hit = classes.find(
      (c) => c.id === `${toLevel}${ref.slice(prefix.length)}`,
    );
    if (hit) return hit;
  }
  const byName = classes.filter((c) => normalize(c.name) === normalize(ref));
  return byName.length === 1 ? byName[0] : null;
}

/**
 * @param {any} data
 * @returns {{data:any, added:number, skipped:{message:string}[]}}
 */
function applyContinuity(data) {
  const lastYear = Array.isArray(data?.lastYear) ? data.lastYear : [];
  const teachers = new Map((data?.teachers || []).map((t) => [t.id, t]));
  const groups = data?.groups || [];
  const assignments = [...(data?.assignments || [])];
  const skipped = [];
  let added = 0;

  for (const row of lastYear) {
    if (!CARRY_OVER_LEVELS.includes(row.level)) continue;
    const what = `${row.subjectId} for "${row.classRef}" (Sec ${row.level} last year)`;
    const skip = (why) => skipped.push({ message: `${what}: ${why}` });

    const cls = targetClass(data, row);
    if (!cls) {
      skip(`no Sec ${row.level + 1} class matches it this year.`);
      continue;
    }
    const teacher = teachers.get(row.teacherId);
    if (!teacher) {
      skip("the teacher is no longer in the Teachers table.");
      continue;
    }
    const group = groups.find(
      (g) =>
        g.level === row.level + 1 &&
        g.subjectId === row.subjectId &&
        Array.isArray(g.classIds) &&
        g.classIds.includes(cls.id),
    );
    if (!group) {
      skip(
        `there is no group for ${cls.name} (Sec ${cls.level}) in that subject this year.`,
      );
      continue;
    }
    if (!(teacher.qualifications || []).includes(group.subjectId)) {
      skip(`${teacher.name} is not qualified for it any more.`);
      continue;
    }
    if (isDenied(teacher, group)) {
      skip(`${teacher.name} is on a deny list for it.`);
      continue;
    }
    const seats = assignments.filter((a) => a.groupId === group.id);
    if (seats.some((a) => a.teacherId === teacher.id)) {
      skip(`${teacher.name} is already placed on it (left as you have it).`);
      continue;
    }
    if (seats.length >= group.teachersNeeded) {
      skip("the group already has all the teachers it needs.");
      continue;
    }
    assignments.push({
      teacherId: teacher.id,
      groupId: group.id,
      locked: true,
    });
    added += 1;
  }

  return { data: added > 0 ? { ...data, assignments } : data, added, skipped };
}

export { applyContinuity };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/unit/continuity.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — propose `feat(continuity): add applyContinuity for Sec 1-2 and Sec 3-4`; wait for approval.

---

### Task 10: Intake UI (Teachers tab) and e2e

**Files:**

- Create: `src/ui/intake.js`, `tests/e2e/intake.spec.js`
- Modify: `index.html` (inside `#panel-teachers`, after `#qualifications-grid`, ~line 844; styles in the `<style>` block next to `.toolbar`), `src/ui.js` (import near line 42; `wireIntake()` call in the `if (!wired)` block after `wireTeachers();`)

**Interfaces:**

- Consumes: `KINDS, templateRows, rowsFromPaste, parseIntake` (Task 8); `getXLSX` from `src/excel.js`; `getData, setData` from `src/ui/store.js`; `recordUndoPoint` from `src/ui/board.js`; `esc` from `src/ui/dom.js`.
- Produces: `wireIntake()`. Static markup in `index.html` (one card per kind) so a half-typed paste survives re-renders.

- [ ] **Step 1: Write the failing e2e test** `tests/e2e/intake.spec.js` (copy the three helpers from `tests/e2e/board.spec.js`: `signInAsHod`, `readStoredData`, `writeStoredData`, `loadSample`, lines 3-53; do not import across spec files):

```js
import { test, expect } from "@playwright/test";

// --- helpers copied from board.spec.js (each spec file is self-contained) ---
// signInAsHod(page, email), readStoredData(page), writeStoredData(page, mutate), loadSample(page)
// ---------------------------------------------------------------------------

async function openTeachers(page) {
  await page.click('nav.tabs button[data-tab="teachers"]');
  await expect(page.locator("#intake")).toBeVisible();
}
const card = (page, kind) =>
  page.locator(`#intake .intake-card[data-kind="${kind}"]`);

test.describe("Intake", () => {
  test("pasting form teachers shows a preview, then saves them", async ({
    page,
  }) => {
    await loadSample(page);
    await openTeachers(page);
    const c = card(page, "formTeachers");
    await c
      .locator('[data-role="intake-paste"]')
      .fill("Class\tForm teacher\r\n102\tAmy Lim\r\n201\tBen Ong\r\n");
    await c.locator('[data-action="intake-preview"]').click();
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "2 row(s) ready",
    );
    await c.locator('[data-action="intake-save"]').click();
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "Saved",
    );
    const data = await readStoredData(page);
    expect(data.classes.find((x) => x.id === "102").formTeacherId).toBe("t1");
    expect(data.classes.find((x) => x.id === "201").formTeacherId).toBe("t2");
  });

  test("a row that does not match is explained and Save stays disabled", async ({
    page,
  }) => {
    await loadSample(page);
    await openTeachers(page);
    const c = card(page, "formTeachers");
    await c
      .locator('[data-role="intake-paste"]')
      .fill("999\tAmy Lim\n102\tNobody Here");
    await c.locator('[data-action="intake-preview"]').click();
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "Row 2",
    );
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "No class matches",
    );
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "No teacher matches",
    );
    await expect(c.locator('[data-action="intake-save"]')).toBeDisabled();
  });

  test("the template downloads as an Excel file", async ({ page }) => {
    await loadSample(page);
    await openTeachers(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      card(page, "denies").locator('[data-action="intake-template"]').click(),
    ]);
    expect(download.suggestedFilename()).toBe("deny-list-template.xlsx");
  });

  test("an uploaded filled file is read, previewed and saved", async ({
    page,
  }) => {
    await loadSample(page);
    await openTeachers(page);
    const bytes = await page.evaluate(() => {
      const X = window.XLSX;
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(
        wb,
        X.utils.aoa_to_sheet([
          ["Teacher", "Level", "Stream", "Subject"],
          ["Ben Ong", 1, "G2", ""],
        ]),
        "Template",
      );
      return Array.from(
        new Uint8Array(X.write(wb, { type: "array", bookType: "xlsx" })),
      );
    });
    const c = card(page, "denies");
    await c.locator('[data-role="intake-file"]').setInputFiles({
      name: "denies.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(bytes),
    });
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "1 row(s) ready",
    );
    await c.locator('[data-action="intake-save"]').click();
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "Saved",
    );
    const data = await readStoredData(page);
    expect(data.teachers.find((t) => t.id === "t2").denies).toEqual([
      { level: 1, stream: "G2" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test tests/e2e/intake.spec.js`
Expected: FAIL (`#intake` is not on the page).

- [ ] **Step 3: Implement.**

`index.html`: after `<div id="qualifications-grid"></div>` (inside `#panel-teachers`) add:

```html
<section id="intake" class="intake">
  <h2>Intake from Excel</h2>
  <p class="muted">
    Fill in a template, upload it (or paste the rows), check the preview, then
    save. Each upload replaces that list.
  </p>
  <div class="intake-card" data-kind="formTeachers">
    <h3>Form teachers</h3>
    <p class="muted">One row per class: Class | Form teacher</p>
    <div class="toolbar">
      <button data-action="intake-template">Download template</button>
      <button data-action="intake-upload">Upload filled file…</button>
      <input type="file" accept=".xlsx" hidden data-role="intake-file" />
    </div>
    <textarea
      data-role="intake-paste"
      rows="4"
      placeholder="…or paste rows copied from Excel"
    ></textarea>
    <div class="toolbar">
      <button data-action="intake-preview">Check pasted rows</button>
    </div>
    <div data-role="intake-preview" role="status" aria-live="polite"></div>
    <button class="primary" data-action="intake-save" disabled>
      Save form teachers
    </button>
  </div>
  <div class="intake-card" data-kind="lastYear">
    <h3>Last year's teachers</h3>
    <p class="muted">
      Level | Class | Subject | Teacher (last year's level and class)
    </p>
    <div class="toolbar">
      <button data-action="intake-template">Download template</button>
      <button data-action="intake-upload">Upload filled file…</button>
      <input type="file" accept=".xlsx" hidden data-role="intake-file" />
    </div>
    <textarea
      data-role="intake-paste"
      rows="4"
      placeholder="…or paste rows copied from Excel"
    ></textarea>
    <div class="toolbar">
      <button data-action="intake-preview">Check pasted rows</button>
    </div>
    <div data-role="intake-preview" role="status" aria-live="polite"></div>
    <button class="primary" data-action="intake-save" disabled>
      Save last year's teachers
    </button>
  </div>
  <div class="intake-card" data-kind="denies">
    <h3>Deny list</h3>
    <p class="muted">
      Teacher | Level | Stream | Subject (leave a cell blank for "any")
    </p>
    <div class="toolbar">
      <button data-action="intake-template">Download template</button>
      <button data-action="intake-upload">Upload filled file…</button>
      <input type="file" accept=".xlsx" hidden data-role="intake-file" />
    </div>
    <textarea
      data-role="intake-paste"
      rows="4"
      placeholder="…or paste rows copied from Excel"
    ></textarea>
    <div class="toolbar">
      <button data-action="intake-preview">Check pasted rows</button>
    </div>
    <div data-role="intake-preview" role="status" aria-live="polite"></div>
    <button class="primary" data-action="intake-save" disabled>
      Save deny list
    </button>
  </div>
</section>
```

In the `<style>` block add (next to `.toolbar`):

```css
.intake-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  margin: 10px 0;
}
.intake-card textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
}
.intake-card .problems {
  color: #b00020;
  margin: 4px 0;
  padding-left: 20px;
}
```

`src/ui/intake.js`:

```js
// Intake cards (Teachers tab): download a template, upload a filled file or
// paste rows, preview what matched, then save. The markup is static in
// index.html so a half-typed paste survives re-renders; all decisions live in
// src/intake.js. Save stays disabled while any row has a problem.

import { getData, setData } from "./store.js";
import { esc } from "./dom.js";
import { getXLSX } from "../excel.js";
import { recordUndoPoint } from "./board.js";
import { templateRows, rowsFromPaste, parseIntake } from "../intake.js";

const FILE_NAMES = {
  formTeachers: "form-teachers-template.xlsx",
  lastYear: "last-year-teachers-template.xlsx",
  denies: "deny-list-template.xlsx",
};
const SAVED_WHAT = {
  formTeachers: "form teacher(s)",
  lastYear: "last-year row(s)",
  denies: "deny rule(s)",
};

const pending = {}; // kind -> parse result waiting for Save

const q = (card, role) => card.querySelector(`[data-role="${role}"]`);
const saveButton = (card) => card.querySelector('[data-action="intake-save"]');

function showPreview(card, kind, rows) {
  const result = parseIntake(kind, rows, getData());
  const box = q(card, "intake-preview");
  const save = saveButton(card);
  pending[kind] = result;
  const lines = [];
  if (result.accepted.length === 0 && result.problems.length === 0) {
    lines.push("<p>No rows found. Paste rows or upload a filled template.</p>");
  } else {
    lines.push(
      `<p><strong>${esc(result.accepted.length)} row(s) ready</strong>${
        result.problems.length > 0
          ? `, ${esc(result.problems.length)} need fixing`
          : ""
      }.</p>`,
    );
  }
  if (result.problems.length > 0) {
    lines.push(
      `<ul class="problems">${result.problems
        .map((p) => `<li>Row ${esc(p.row)}: ${esc(p.message)}</li>`)
        .join(
          "",
        )}</ul><p>Fix these in your sheet and upload or paste it again - nothing is saved until every row matches.</p>`,
    );
  }
  box.innerHTML = lines.join("");
  save.disabled = result.problems.length > 0 || result.accepted.length === 0;
}

function downloadTemplate(kind) {
  const XLSX = getXLSX();
  const { headers, current, example } = templateRows(kind, getData());
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([headers, ...current]),
    "Template",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([headers, example]),
    "Example",
  );
  XLSX.writeFile(wb, FILE_NAMES[kind]);
}

async function readUpload(file) {
  const XLSX = getXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  // The first sheet is the one to fill in ("Template"); "Example" is ignored.
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
}

function wireIntake() {
  const root = document.getElementById("intake");
  if (!root) return;

  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    const card = e.target.closest(".intake-card");
    if (!el || !card) return;
    const kind = card.dataset.kind;
    const action = el.dataset.action;

    if (action === "intake-template") {
      try {
        downloadTemplate(kind);
      } catch (err) {
        q(card, "intake-preview").innerHTML =
          `<p class="problems">Could not make the template: ${esc(err.message)}. Reload the page and try again.</p>`;
      }
    } else if (action === "intake-upload") {
      q(card, "intake-file").click();
    } else if (action === "intake-preview") {
      showPreview(
        card,
        kind,
        rowsFromPaste(kind, q(card, "intake-paste").value),
      );
    } else if (action === "intake-save") {
      const result = pending[kind];
      if (!result || result.problems.length > 0 || result.accepted.length === 0)
        return;
      recordUndoPoint(); // so Undo on the Board can reverse this
      setData(result.next);
      delete pending[kind];
      saveButton(card).disabled = true;
      q(card, "intake-paste").value = "";
      q(card, "intake-preview").innerHTML =
        `<p><strong>Saved ${esc(result.accepted.length)} ${esc(SAVED_WHAT[kind])}.</strong></p>`;
    }
  });

  root.addEventListener("change", async (e) => {
    if (e.target.dataset.role !== "intake-file") return;
    const card = e.target.closest(".intake-card");
    const file = e.target.files[0];
    e.target.value = ""; // allow picking the same file again
    if (!file || !card) return;
    try {
      showPreview(card, card.dataset.kind, await readUpload(file));
    } catch (err) {
      q(card, "intake-preview").innerHTML =
        `<p class="problems">Could not read that file: ${esc(err.message)}. Use the downloaded template and save it as .xlsx.</p>`;
    }
  });
}

export { wireIntake };
```

`src/ui.js`: add `import { wireIntake } from "./ui/intake.js";` after the `renderTeachers` import (line 42) and `wireIntake();` after `wireTeachers();` in the `if (!wired)` block.

- [ ] **Step 4: Run to verify it passes**

Run: `npx playwright test tests/e2e/intake.spec.js`
Expected: 4 PASS. (The Playwright config starts its own server and the Firestore/Auth emulators, as for the other specs.)

- [ ] **Step 5: Commit** — propose `feat(ui): add Excel intake for form teachers, last year and deny list`; wait for approval.

---

### Task 11: Board — Apply continuity button and team-taught badge

**Files:**

- Modify: `index.html` (Board toolbar after the Redo button ~line 914; a report div after `#board-solve-status` ~line 920; `.team-badge` CSS next to `.size-badge` ~line 513), `src/ui/board.js` (import at line 25; `renderRow` ~line 242; click handler ~line 404)
- Test: `tests/e2e/intake.spec.js` (append)

**Interfaces:**

- Consumes: `applyContinuity` (Task 9); the Board's `commit(result, message)`, `toast`, `getData`.
- Produces: button `data-action="apply-continuity"`; report container `#board-continuity-report`; badge `<span class="team-badge">` on rows with `teachersNeeded > 1`.

- [ ] **Step 1: Append failing e2e tests** to `tests/e2e/intake.spec.js` (inside the same `describe`, or a second one using the same helpers; also add this helper near the top: `async function openBoard(page) { await page.click('nav.tabs button[data-tab="board"]'); await expect(page.locator("#board-body .board-card").first()).toBeVisible(); }`):

```js
test("Apply continuity locks last year's teacher on the Board and reports what it skipped", async ({
  page,
}) => {
  await loadSample(page);
  await writeStoredData(page, (d) => ({
    ...d,
    lastYear: [
      { level: 1, classRef: "101", subjectId: "G1_LSS", teacherId: "t1" }, // -> Sec 2 G1 LSS group
      { level: 1, classRef: "199", subjectId: "G1_LSS", teacherId: "t1" }, // no such class
    ],
  }));
  await openBoard(page);
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Lock 1 placement");
    dialog.accept();
  });
  await page.click('[data-action="apply-continuity"]');
  await expect(page.locator("#board-toast")).toContainText(
    "Locked 1 placement",
  );
  await expect(page.locator("#board-continuity-report")).toContainText(
    "no Sec 2 class matches",
  );
  const data = await readStoredData(page);
  expect(data.assignments).toContainEqual({
    teacherId: "t1",
    groupId: "g_G1_LSS_b-2",
    locked: true,
  });
});

test("Apply continuity with nothing loaded says what to do next", async ({
  page,
}) => {
  await loadSample(page);
  await writeStoredData(page, (d) => ({ ...d, lastYear: [] }));
  await openBoard(page);
  await page.click('[data-action="apply-continuity"]');
  await expect(page.locator("#board-toast")).toContainText(
    "Last year's teachers",
  );
});

test("a team-taught group is marked on the Board", async ({ page }) => {
  await loadSample(page);
  await writeStoredData(page, (d) => ({
    ...d,
    groups: d.groups.map((g) =>
      g.id === "g_G1_LSS_b-2" ? { ...g, teachersNeeded: 2 } : g,
    ),
  }));
  await openBoard(page);
  await expect(
    page.locator('[data-group-id="g_G1_LSS_b-2"] .team-badge'),
  ).toBeVisible();
  await expect(
    page.locator('[data-group-id="g_G2_LSS_b-2"] .team-badge'),
  ).toHaveCount(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test tests/e2e/intake.spec.js -g "continuity|team-taught"`
Expected: FAIL (no `apply-continuity` button, no `.team-badge`).

- [ ] **Step 3: Implement.**

`index.html`: after the Redo `</button>` add:

```html
<button
  data-action="apply-continuity"
  class="secondary"
  title="Lock last year's teacher on their class for Sec 1 to 2 and Sec 3 to 4"
>
  Lock last year's teachers
</button>
```

after `<div id="board-solve-status"></div>` add `<div id="board-continuity-report"></div>`; CSS after `.size-badge.big { ... }`:

```css
.team-badge {
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 4px;
  margin-left: 4px;
  background: #e8f0fe;
}
```

`src/ui/board.js`: add `import { applyContinuity } from "../continuity.js";` after the `../setup.js` import. In `renderRow`, change the `row-meta` span to include the badge after the size badge:

```js
        <span class="row-meta">${esc(row.periods)}p <span class="size-badge ${row.isBig ? "big" : ""}">${row.isBig ? "BIG" : "sm"}</span>${row.teachersNeeded > 1 ? '<span class="team-badge" title="Team-taught: each teacher carries the full periods">&#8644; team</span>' : ""}</span>
```

In the click handler, add before the `toggle-details` branch:

```js
    } else if (action === "apply-continuity") {
      const report = document.getElementById("board-continuity-report");
      const res = applyContinuity(data);
      const lines = res.skipped.map((s) => `<li>${esc(s.message)}</li>`).join("");
      if (res.added === 0) {
        if (report) report.innerHTML = lines ? `<ul class="problems">${lines}</ul>` : "";
        toast(
          res.skipped.length > 0
            ? "Nothing could be locked - see the reasons below the toolbar."
            : "No last-year teachers to lock yet. Add them under Teachers → Intake from Excel → Last year's teachers.",
          "error",
        );
        return;
      }
      if (
        !confirm(
          `Lock ${res.added} placement(s) from last year (Sec 1 to 2 and Sec 3 to 4)?\n\n${res.skipped.length} will be skipped. Seats you have already placed are left as they are.`,
        )
      )
        return;
      if (commit({ data: res.data, error: null }, `Locked ${res.added} placement(s) from last year. ${res.skipped.length} skipped.`)) {
        if (report) report.innerHTML = lines ? `<p>Skipped:</p><ul class="problems">${lines}</ul>` : "";
      }
```

(`esc` is already imported in `board.js`; the new branch uses `else if` chained like its neighbours, so place it inside the existing `if / else if` chain.)

- [ ] **Step 4: Run to verify they pass, then the full e2e**

Run: `npx playwright test tests/e2e/intake.spec.js` then `npx playwright test`
Expected: PASS (all intake specs; the earlier 35 still pass).

- [ ] **Step 5: Commit** — propose `feat(board): add "Lock last year's teachers" and a team-taught badge`; wait for approval.

---

### Task 12: Docs and final verification

**Files:**

- Modify: `CLAUDE.md` (project), `docs/superpowers/specs/2026-10-04-data-and-rule-layers-design.md`

**Interfaces:** none (documentation and verification only).

- [ ] **Step 1: Update the spec** — append a "Planning amendments" section to the spec listing the six items under "Plan amendments" at the top of this plan (graduating split into two layers; `classRef`; template sheets and Save-blocked-on-problems; Intake in the Teachers tab; graduating settings Excel-only; deny shows a Board warning).

- [ ] **Step 2: Update project `CLAUDE.md`** — in the Key files table add rows for `src/intake.js` (pure: templates, paste/upload rows → matched data; used by `src/ui/intake.js`), `src/continuity.js` (pure `applyContinuity`: locked assignments from `data.lastYear`), and in the "How to add a new constraint layer" section add one line under step 5: "`formTeacher_` and `graduatingMax_` are in `HARD_PREFIXES`; `deny` is structural (like `qualification`) so it has no prefix."

- [ ] **Step 3: Full verification** (evidence before any claim of success)

Run: `npm test` then `npm run test:rules` then `npx playwright test`
Expected: all PASS. Report the three counts.

- [ ] **Step 4: Hands-on check on the sample school** — `npm run emulators` and `npm run serve`; sign in, then on the Teachers tab download each template, fill one row, upload it and save; on the Board press "Lock last year's teachers" and confirm the lock chips; press Solve and confirm the form teacher, deny and graduating rules show in the result and the Layers tab lists the four new layers. Report what you saw.

- [ ] **Step 5: Commit** — propose `docs: document intake, continuity and the new rule layers`; wait for approval. Do not push.

---

## Self-Review

**Spec coverage:** data fields (Task 1, 2); `deny` (3); `formTeacher` (4); graduating hard + soft (5, split noted); preps by level incl. the tally (6); sample + layer defaults (2, 7); intake templates/upload/paste/matching/preview (8, 10); `applyContinuity` for Sec 1→2 and 3→4, never re-locking unlocked seats (9, 11); team-taught marker (11); diagnose wording and prefixes (3, 4, 5); old-file safety (1, 2, 6); tests unit + e2e (every task); docs (12). The spec's "Remaining questions" stay out of scope.

**Placeholder scan:** no TBD/TODO; every code step has code. The two "if an existing test hard-codes X, update it" instructions name the specific cause and the only permitted change.

**Type consistency:** `isDenied`, `prepKey`, `graduatingSettings`, `formatDeny`/`parseDeny` (Task 1) are used with the same signatures in Tasks 2-6, 9. `parseIntake` returns `{accepted, problems, next}` (Task 8) and the UI uses exactly those names (Task 10). `applyContinuity` returns `{data, added, skipped}` (Task 9), used as such in Task 11. `lastYear` rows are `{level, classRef, subjectId, teacherId}` everywhere (Tasks 1, 2, 8, 9, 11). Constraint prefixes `formTeacher_`, `graduatingMax_`, `graduatingSpread_` match the layer files and `diagnose.js`.

**Review Focus coverage:** (1) Task 8 paste test; (2) Task 8 ambiguity test; (3) Task 9 re-apply test; (4) Tasks 1, 2, 6; (5) Tasks 1, 4, 5.
