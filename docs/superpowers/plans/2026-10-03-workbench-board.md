# Workbench Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Groups tab and the Deployment sheet with one "Board" screen: subject cards with editable group rows, drag-and-drop teacher assignment, a live per-teacher tally, undo/redo, and consistent auto-built group names.

**Architecture:** All board logic is pure functions in a new `src/board.js` (data in, data out, plain-language `error` on refusal), unit-tested without a browser. `src/ui/board.js` only renders HTML strings and routes events to those functions, then calls `setData()` (so Firestore sync and the overwrite guard are untouched). The board owns `data.groups` once any structural edit happens (`groupsFrozen`); setup tabs stop regenerating groups from then on, and a confirmed "Rebuild groups from setup" button is the only way back.

**Tech Stack:** Vanilla ES modules (no build step), `node --test`, Playwright, Firestore emulator, HiGHS (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-03-workbench-board-design.md` (see "Planning amendments" at its end for six small changes found while planning).

**Commits:** The user's rule is _never auto-commit_. Every "Commit" step below means: propose the message and wait for approval. Messages end with the attribution lines from the session's system reminder.

## Global Constraints

- No build step; every `src/` file stays a native ES module (`<script type="module">` / `node --test` imports).
- No real student/teacher data anywhere in the repo; only the fictional `sample/` school.
- Re-opening a saved file or restoring a version never re-solves; only the Solve button solves.
- Old files without the new fields (`groupsFrozen`, `settings`, `manualLabel`) must load and behave exactly as before.
- Every interpolated value in HTML (text and attribute values) goes through `esc()` from `src/ui/dom.js`.
- Never write an `undefined` value into `data` (Firestore rejects it). Use `delete` or conditional spread.
- UX baseline: every action gives visible feedback; errors are plain language with a next step; button labels name the outcome.
- Run commands: unit `node --test tests/unit/<file>.test.js` (fast, no emulator) and `npm test` (all unit tests, needs Java for the emulator); e2e `npx playwright test <file>` (starts http-server and the emulators itself; needs Java).
- The e2e server serves the repo directly, so no frontend build is needed before Playwright.

## Review Focus

Failure modes the spec implies but no obvious task test covers; each has a test in the owning task.

1. **`undefined` leaking into saved data** (e.g. `groupsFrozen`, `manualLabel` after an op or an undo) would make Firestore reject the save. Owned by Task 4 (`assertPlain` on every op) and Task 11 (undo snapshot).
2. **Two groups that auto-name identically** (a band split into 3 groups) must get `#1/#2/#3`, not three identical rows. Task 3.
3. **A stale assignment** (teacher or group id that no longer exists) must show the raw id, not crash the board or tally. Task 3 and Task 6.
4. **Lowering "teachers needed"** below the seats already filled must trim seats, and **deleting a group** must delete its assignments. Task 4.
5. **Empty school** (no groups, no teachers) must render a helpful message, not throw. Task 3 and Task 6.

## File Structure

| File                                                                     | Responsibility                                                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `src/data.js` (modify)                                                   | `bigThreshold(data)`, `DEFAULT_BIG_PERIODS`, validation of `settings`, `groupsFrozen`, `manualLabel`. |
| `src/board.js` (new)                                                     | Pure board logic: labels, `buildBoard`, `buildTally`, group ops, seat ops, `rebuildFromSetup`.        |
| `src/ui/board.js` (new)                                                  | Board tab rendering, event wiring, drag-and-drop, undo/redo, toasts.                                  |
| `src/setup.js` (modify)                                                  | `applySetupEdit(next)`: skip regeneration when the board owns groups.                                 |
| `src/ui/rebuild.js` (new)                                                | Shared "Rebuild groups from setup" button wiring (Classes + Bands tabs).                              |
| `src/view.js` (modify)                                                   | Use `bigThreshold`; export `blockSortKey`. Rest stays (Excel layout and tests use it).                |
| `src/layers/mix.js`, `groupCount.js`, `src/diagnose.js` (modify)         | Use `bigThreshold(data)` instead of the constant.                                                     |
| `src/excel.js`, `src/versions.js` (modify)                               | Carry `manualLabel`, `groupsFrozen`, `settings.bigPeriods`.                                           |
| `src/ui.js`, `index.html` (modify)                                       | Board tab, Solve button on the board, remove Groups/Deployment tabs.                                  |
| `src/ui/groups.js`, `src/ui/deployment.js` (delete, Task 12)             | Replaced by the board.                                                                                |
| `tests/unit/settings.test.js`, `tests/unit/board.test.js` (new)          | Unit tests.                                                                                           |
| `tests/e2e/board.spec.js` (new), `tests/e2e/deployment.spec.js` (modify) | End-to-end tests.                                                                                     |

---

### Task 1: Configurable big/small threshold

**Files:**

- Modify: `src/data.js` (add helper + validation), `src/layers/mix.js`, `src/layers/groupCount.js`, `src/view.js:14-15,174,204`, `src/diagnose.js:14,115,121,328`
- Create: `tests/unit/settings.test.js`

**Interfaces:**

- Produces: `DEFAULT_BIG_PERIODS = 10`, `bigThreshold(data) -> number` (exported from `src/data.js`). `BIG_PERIODS` is removed from `src/layers/mix.js`.

- [ ] **Step 1: Write the failing tests** — create `tests/unit/settings.test.js`:

```js
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
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test tests/unit/settings.test.js`
Expected: FAIL (`bigThreshold` is not exported from `src/data.js`).

- [ ] **Step 3: Implement.** In `src/data.js`, add above `emptyData()`:

```js
const DEFAULT_BIG_PERIODS = 10;

/**
 * Periods at or above which a group counts as "big". The HOD can change it
 * (data.settings.bigPeriods); anything that isn't a positive number falls back
 * to the default so old files behave exactly as before.
 * @param {any} data
 * @returns {number}
 */
function bigThreshold(data) {
  const n = data?.settings?.bigPeriods;
  return typeof n === "number" && Number.isFinite(n) && n >= 1
    ? n
    : DEFAULT_BIG_PERIODS;
}
```

Change the export line at the bottom of `src/data.js` to:

```js
export {
  emptyData,
  validate,
  migrateV1,
  effectiveCap,
  bigThreshold,
  DEFAULT_BIG_PERIODS,
};
```

In `validateGroupShape` (after the `bandId` check, before the closing brace) add:

```js
if (typeof g.manualLabel !== "undefined" && typeof g.manualLabel !== "boolean")
  errors.push(`${arrayName}[${i}].manualLabel must be true or false.`);
```

In `validate()`, directly before the `// Cross-reference checks only if both arrays` comment add:

```js
if (
  typeof data.groupsFrozen !== "undefined" &&
  typeof data.groupsFrozen !== "boolean"
)
  errors.push("groupsFrozen must be true or false.");
if (typeof data.settings !== "undefined") {
  if (
    !data.settings ||
    typeof data.settings !== "object" ||
    Array.isArray(data.settings)
  ) {
    errors.push("settings must be an object.");
  } else if (
    typeof data.settings.bigPeriods !== "undefined" &&
    !(
      typeof data.settings.bigPeriods === "number" &&
      Number.isInteger(data.settings.bigPeriods) &&
      data.settings.bigPeriods >= 1
    )
  ) {
    errors.push("settings.bigPeriods must be a whole number of 1 or more.");
  }
}
```

Add to the `Group` JSDoc typedef in `src/data.js` the field `manualLabel?:boolean`.

In `src/layers/mix.js`: delete the line `const BIG_PERIODS = 10;`, add `import { bigThreshold } from "../data.js";` at the top (below the header comment), and change:

```js
  describe(data) {
    return `Give each teacher about as many big groups (${bigThreshold(data)}+ periods) as small ones.`;
  },
  build(ctx) {
    const weight = ctx.weight("mix");
    if (!weight) return;
    const threshold = bigThreshold(ctx.data);
```

and `(g.periods >= BIG_PERIODS ? big : small)` to `(g.periods >= threshold ? big : small)`; change the last line to `export { mixLayer };`.

In `src/layers/groupCount.js`: replace `import { BIG_PERIODS } from "./mix.js";` with `import { bigThreshold } from "../data.js";`; change `describe()` to `describe(data)` using `${bigThreshold(data)}+ periods`; at the top of `build(ctx)` add `const threshold = bigThreshold(ctx.data);`; change `g.periods >= BIG_PERIODS` to `g.periods >= threshold`; update the header comment `(BIG_PERIODS+ periods)` to `(the big/small cut-off, default 10 periods)`.

In `src/view.js`: change line 14-15 to `import { effectiveCap, bigThreshold } from "./data.js";` (delete the `BIG_PERIODS` import), in `buildTeacherView` add `const threshold = bigThreshold(data);` after `const roleById = ...` and change `g.periods >= BIG_PERIODS` to `g.periods >= threshold`; change the JSDoc comment `big = BIG_PERIODS+ periods` to `big = bigThreshold(data)+ periods`. Also export the sort helper: change the export list to include `blockSortKey`.

In `src/diagnose.js`: delete the `import { BIG_PERIODS } from "./layers/mix.js";` line and add `bigThreshold` to the existing `./data.js` import. In `preCheck` (above the `for (const p of model.pairs)` loop) add `const threshold = bigThreshold(data);` and use it at line 115 (`g.periods >= threshold`) and line 121 (`(${threshold}+ periods)`). In `explainConstraint` change line 328 to `` `big (${bigThreshold(data)}+ periods)` ``.

- [ ] **Step 4: Run to confirm pass**

Run: `node --test tests/unit/settings.test.js` → PASS. Then `node --test tests/unit/layers/groupCount.test.js tests/unit/layers/mix-preps.test.js tests/unit/diagnose.test.js tests/unit/view.test.js tests/unit/data.test.js` → PASS (no behaviour change at the default 10).

- [ ] **Step 5: Commit** — propose `feat(settings): make the big/small cut-off configurable` and wait for approval.

---

### Task 2: New data fields carried by Excel and Versions

**Files:**

- Modify: `src/excel.js` (`groupToRow`, `rowToGroup`, `dataToSheets`, `sheetsToData`, header comment), `src/versions.js:29-38`
- Test: `tests/unit/excel.test.js` (append), `tests/unit/versions.test.js` (append)

**Interfaces:**

- Consumes: `data.groupsFrozen?: boolean`, `data.settings?: {bigPeriods?: number}`, `group.manualLabel?: boolean` (Task 1 validation).
- Produces: a new `Settings` sheet (`key`, `value` rows); round-trip keeps absent fields absent.

- [ ] **Step 1: Write the failing tests.** Append to `tests/unit/excel.test.js`:

```js
test("sheetsToData()/dataToSheets() round-trip groupsFrozen, bigPeriods and a manual group label", () => {
  const data = minimalData({
    groupsFrozen: true,
    settings: { bigPeriods: 8 },
    groups: [
      {
        id: "g1",
        level: 3,
        block: "Phy",
        label: "My label",
        manualLabel: true,
        periods: 6,
        band: null,
        teachersNeeded: 1,
        category: "",
        note: "",
        subjectId: null,
        discipline: "",
        stream: "",
        classIds: [],
        bandId: null,
      },
    ],
  });
  assert.deepEqual(sheetsToData(dataToSheets(data)), data);
});

test("an old file with no Settings sheet loads with neither groupsFrozen nor settings", () => {
  const out = sheetsToData({});
  assert.equal("groupsFrozen" in out, false);
  assert.equal("settings" in out, false);
});
```

Append to `tests/unit/versions.test.js`:

```js
test("a full snapshot restores groupsFrozen and the big/small threshold", async () => {
  const data = fullData({ groupsFrozen: true, settings: { bigPeriods: 8 } });
  const id = await saveVersion(db, "frozen", data, "2026-02-01T00:00:00Z");
  const restored = await restoreVersion(db, fullData(), id);
  assert.equal(restored.groupsFrozen, true);
  assert.deepEqual(restored.settings, { bigPeriods: 8 });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test tests/unit/excel.test.js` → the new round-trip test FAILS. (`versions.test.js` needs the emulator; it is checked in Step 4 via `npm test`.)

- [ ] **Step 3: Implement.** In `src/excel.js`:

In `groupToRow`, add the line `manualLabel: Boolean(g.manualLabel),` after `bandId`. In `rowToGroup`, change the returned object to end with:

```js
    bandId: row.bandId ? String(row.bandId) : null,
    ...(toBool(row.manualLabel) ? { manualLabel: true } : {}),
  };
```

In `dataToSheets`, add a `Settings` entry before `Versions` (only defined values are written, so old data round-trips unchanged):

```js
    Settings: [
      ...(data.groupsFrozen === undefined
        ? []
        : [{ key: "groupsFrozen", value: Boolean(data.groupsFrozen) }]),
      ...(data.settings && data.settings.bigPeriods !== undefined
        ? [{ key: "bigPeriods", value: data.settings.bigPeriods }]
        : []),
    ],
```

Add `Settings:object[]` to the two JSDoc shapes. In `sheetsToData`, replace the final `return { ... };` with:

```js
const settingRows = Array.isArray(sheets.Settings) ? sheets.Settings : [];
const setting = (key) => settingRows.find((r) => r.key === key)?.value;
const frozen = setting("groupsFrozen");
const bigPeriods = setting("bigPeriods");

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
  ...(bigPeriods === undefined || bigPeriods === ""
    ? {}
    : { settings: { bigPeriods: toNumber(bigPeriods) } }),
};
```

Update the top-of-file comment's sheet list to include `Settings`. In `src/versions.js` add `"groupsFrozen",` and `"settings",` to the end of `SETUP_FIELDS`.

- [ ] **Step 4: Run to confirm pass**

Run: `node --test tests/unit/excel.test.js` → PASS. If an existing test counts sheet keys, update that expectation to include `Settings`. Then `npm test` → PASS (includes `versions.test.js`).

- [ ] **Step 5: Commit** — propose `feat(data): carry groupsFrozen, manual labels and the big/small cut-off through Excel and versions`.

---

### Task 3: Board read-model (labels, sorting, rows, warnings)

**Files:**

- Create: `src/board.js`, `tests/unit/board.test.js`

**Interfaces:**

- Consumes: `bigThreshold` (Task 1), `blockSortKey` (Task 1), `blockFromDiscipline`/`rebuildGroups` from `src/setup.js`, `buildSummary`/`buildTeacherView` from `src/view.js`, `isSet` from `src/layers/groupCount.js`.
- Produces (all in `src/board.js`):
  - `groupLabel(group) -> string`, `relabel(groups) -> groups`, `autoLabels(groups) -> string[]`
  - `isQualified(teacher, group) -> boolean`
  - `buildBoard(data, arrange: "subject"|"level") -> { arrange, sections: {key,title,cards: {key,level,block,title,rows: Row[]}[]}[] }`
  - `Row = { groupId, name, level, block, subjectId, periods, isBig, stream, classIds, teachersNeeded, note, manualLabel, seats: {index,teacherId,teacherName,locked,placeholder,qualified}[], complete, warnings: string[] }`

- [ ] **Step 1: Write the failing tests** — create `tests/unit/board.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as b from "../../src/board.js";
import { validate } from "../../src/data.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSample() {
  return JSON.parse(
    readFileSync(path.join(__dirname, "../../sample/sample.json"), "utf8"),
  );
}

function grp(
  id,
  level,
  block,
  stream,
  classIds,
  subjectId,
  periods,
  extra = {},
) {
  return {
    id,
    level,
    block,
    label: "x",
    periods,
    band: null,
    teachersNeeded: 1,
    category: stream,
    note: "",
    subjectId,
    discipline: block.toUpperCase(),
    stream,
    classIds,
    bandId: null,
    ...extra,
  };
}

function fixture() {
  return {
    roles: [
      { id: "teacher", name: "Teacher", maxPeriods: 20 },
      { id: "hod", name: "HOD", maxPeriods: 10 },
    ],
    subjects: [
      {
        id: "G2_PHY",
        name: "G2 Phy",
        discipline: "PHY",
        stream: "G2",
        periods: 6,
        levels: [3],
      },
      {
        id: "G3_PHY",
        name: "G3 Phy",
        discipline: "PHY",
        stream: "G3",
        periods: 6,
        levels: [3],
      },
      {
        id: "LSS",
        name: "LSS",
        discipline: "LSS",
        stream: "G1",
        periods: 12,
        levels: [1],
      },
    ],
    classes: [
      { id: "3E1", level: 3, name: "E1", subjectIds: [] },
      { id: "3E2", level: 3, name: "E2", subjectIds: [] },
    ],
    bands: [],
    teachers: [
      {
        id: "t1",
        name: "Amy",
        roleId: "teacher",
        capOverride: null,
        qualifications: ["G2_PHY", "G3_PHY"],
      },
      {
        id: "t2",
        name: "Ben",
        roleId: "teacher",
        capOverride: null,
        qualifications: ["G2_PHY"],
      },
      {
        id: "t3",
        name: "Cat",
        roleId: "hod",
        capOverride: null,
        qualifications: ["LSS"],
      },
    ],
    groups: [
      grp("g1", 3, "Phy", "G2", ["3E1"], "G2_PHY", 6),
      grp("g2", 3, "Phy", "G2", ["3E2"], "G2_PHY", 6),
      grp("g3", 3, "Phy", "G3", ["3N1"], "G3_PHY", 6),
      grp("g4", 1, "LSS", "G1", ["1A"], "LSS", 12),
    ],
    groupOverrides: {},
    customGroups: [],
    assignments: [],
    layerSettings: [],
    versions: [],
  };
}

/** Firestore rejects undefined values; JSON drops them, so a round-trip must be a no-op. */
function assertPlain(data) {
  assert.deepEqual(data, JSON.parse(JSON.stringify(data)));
}

// --- labels -------------------------------------------------------------

test("groupLabel(): one class and no stream is bare", () => {
  assert.equal(
    b.groupLabel(grp("a", 3, "Phy", "", ["3E1"], "S", 6)),
    "S3 Phy 3E1",
  );
});

test("groupLabel(): a stream puts the classes in brackets", () => {
  assert.equal(
    b.groupLabel(grp("a", 3, "Phy", "G2", ["3E1"], "S", 6)),
    "S3 Phy G2 (3E1)",
  );
});

test("groupLabel(): combined classes are joined with +", () => {
  assert.equal(
    b.groupLabel(grp("a", 3, "Phy", "G2", ["3E1", "3E2"], "S", 6)),
    "S3 Phy G2 (3E1+3E2)",
  );
});

test("groupLabel(): no classes yet", () => {
  assert.equal(
    b.groupLabel(grp("a", 4, "Chem", "G3", [], "S", 6)),
    "S4 Chem G3",
  );
});

test("relabel(): numbers identical names in list order and leaves unique ones alone", () => {
  const gs = [
    grp("a", 3, "Phy", "G3", ["3E1", "3E2"], "S", 6),
    grp("b", 3, "Phy", "G3", ["3E1", "3E2"], "S", 6),
    grp("c", 3, "Phy", "G2", ["3E1"], "S2", 6),
  ];
  assert.deepEqual(
    b.relabel(gs).map((g) => g.label),
    ["S3 Phy G3 (3E1+3E2) #1", "S3 Phy G3 (3E1+3E2) #2", "S3 Phy G2 (3E1)"],
  );
});

test("relabel(): keeps a manual label untouched", () => {
  const gs = [
    grp("a", 3, "Phy", "G3", ["3E1"], "S", 6, {
      label: "Club",
      manualLabel: true,
    }),
  ];
  assert.equal(b.relabel(gs)[0].label, "Club");
});

// --- buildBoard -----------------------------------------------------------

test("buildBoard(): rows are sorted by stream then class, groups with no class last", () => {
  const data = fixture();
  data.groups.push(grp("g5", 3, "Phy", "G2", [], "G2_PHY", 6));
  const phy = b
    .buildBoard(data, "subject")
    .sections.find((s) => s.key === "Phy");
  assert.deepEqual(
    phy.cards[0].rows.map((r) => r.groupId),
    ["g1", "g2", "g5", "g3"],
  );
});

test("buildBoard(): arranges sections by subject or by level", () => {
  const data = fixture();
  assert.deepEqual(
    b.buildBoard(data, "subject").sections.map((s) => s.key),
    ["LSS", "Phy"],
  );
  assert.deepEqual(
    b.buildBoard(data, "level").sections.map((s) => s.key),
    ["1", "3"],
  );
});

test("buildBoard(): flags big groups using the configured threshold", () => {
  const data = fixture();
  const rows = b
    .buildBoard(data, "subject")
    .sections.flatMap((s) => s.cards.flatMap((c) => c.rows));
  assert.equal(rows.find((r) => r.groupId === "g4").isBig, true);
  assert.equal(rows.find((r) => r.groupId === "g1").isBig, false);
  data.settings = { bigPeriods: 6 };
  const again = b
    .buildBoard(data, "subject")
    .sections.flatMap((s) => s.cards.flatMap((c) => c.rows));
  assert.equal(again.find((r) => r.groupId === "g1").isBig, true);
});

test("buildBoard(): row warnings for an empty seat, an unqualified teacher and a band clash", () => {
  const data = fixture();
  data.assignments = [{ teacherId: "t2", groupId: "g3", locked: false }];
  data.groups[0] = { ...data.groups[0], bandId: "b1" };
  data.groups[1] = { ...data.groups[1], bandId: "b1" };
  data.assignments.push(
    { teacherId: "t1", groupId: "g1", locked: false },
    { teacherId: "t1", groupId: "g2", locked: false },
  );
  const rows = b
    .buildBoard(data, "subject")
    .sections.flatMap((s) => s.cards.flatMap((c) => c.rows));
  const byId = (id) => rows.find((r) => r.groupId === id);
  assert.match(byId("g4").warnings.join(" "), /Needs 1 more teacher/);
  assert.match(byId("g3").warnings.join(" "), /Ben isn't qualified/);
  assert.match(byId("g1").warnings.join(" "), /same time/);
});

test("buildBoard(): a stale assignment shows the raw id and does not throw", () => {
  const data = fixture();
  data.assignments = [{ teacherId: "ghost", groupId: "g1", locked: false }];
  const rows = b
    .buildBoard(data, "subject")
    .sections.flatMap((s) => s.cards.flatMap((c) => c.rows));
  assert.equal(
    rows.find((r) => r.groupId === "g1").seats[0].teacherName,
    "ghost",
  );
});

test("buildBoard(): an empty school gives no sections", () => {
  assert.deepEqual(
    b.buildBoard({ groups: [], teachers: [], assignments: [] }, "subject")
      .sections,
    [],
  );
});

test("buildBoard() shows a typed custom-group name as typed, even before the board owns the groups", () => {
  const sample = loadSample();
  const rows = b
    .buildBoard(sample, "subject")
    .sections.flatMap((s) => s.cards.flatMap((c) => c.rows));
  assert.equal(
    rows.find((r) => r.groupId === "g-custom-enrich").name,
    "Enrichment: Chem Research Club",
  );
});

test("buildBoard() never modifies an old sample file", () => {
  const sample = loadSample();
  const before = structuredClone(sample);
  b.buildBoard(sample, "subject");
  assert.deepEqual(sample, before);
  assert.deepEqual(validate(sample), []);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test tests/unit/board.test.js`
Expected: FAIL (`src/board.js` does not exist).

- [ ] **Step 3: Implement** — create `src/board.js`:

```js
// Pure board logic for the Workbench tab. Every function takes `data` and
// returns a value or a NEW data object; nothing here touches the DOM or the
// store, so it is unit-testable under `node --test`. Edit operations return
// `{ data, error }`: on refusal `data` is the same object that went in and
// `error` is a plain-language sentence for the toast.

import { bigThreshold } from "./data.js";
import { blockFromDiscipline, rebuildGroups } from "./setup.js";
import { blockSortKey, buildSummary, buildTeacherView } from "./view.js";
import { isSet } from "./layers/groupCount.js";

const STREAM_ORDER = ["G1", "G2", "G3", "PURE"];

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function streamRank(stream) {
  const i = STREAM_ORDER.indexOf(stream);
  return i === -1 ? STREAM_ORDER.length : i;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * Auto-built name: "S3 Phy 3E1", or "S3 Phy G2 (3E1+3E2)" once there is a
 * stream or more than one class.
 * @param {any} g
 */
function groupLabel(g) {
  const classIds = Array.isArray(g.classIds) ? g.classIds : [];
  const classes = classIds.join("+");
  const parts = [`S${g.level}`, g.block];
  if (g.stream) parts.push(g.stream);
  if (classes) {
    parts.push(g.stream || classIds.length > 1 ? `(${classes})` : classes);
  }
  return parts.join(" ");
}

/**
 * The name each group should display, in the same order as `groups`. A group
 * the HOD named by hand (manualLabel) keeps its label; identical auto names
 * get " #1", " #2", ... in list order so no two rows look the same.
 * @param {any[]} groups
 * @returns {string[]}
 */
function autoLabels(groups) {
  const bases = groups.map((g) => (g.manualLabel ? null : groupLabel(g)));
  const totals = new Map();
  bases.forEach((base) => {
    if (base !== null) totals.set(base, (totals.get(base) || 0) + 1);
  });
  const seen = new Map();
  return groups.map((g, i) => {
    const base = bases[i];
    if (base === null) return g.label;
    if (totals.get(base) > 1) {
      const k = (seen.get(base) || 0) + 1;
      seen.set(base, k);
      return `${base} #${k}`;
    }
    return base;
  });
}

/**
 * Mark groups whose label the HOD typed (an old custom group, a label
 * override) as manual so auto-naming leaves them alone.
 * @param {any} data
 * @param {any[]} groups
 */
function markTypedLabels(data, groups) {
  const customIds = new Set((data?.customGroups || []).map((g) => g.id));
  return groups.map((g) => {
    const typed =
      (customIds.has(g.id) && g.label) || data?.groupOverrides?.[g.id]?.label;
    return typed && !g.manualLabel ? { ...g, manualLabel: true } : g;
  });
}

/** @param {any[]} groups @returns {any[]} groups whose `label` is up to date */
function relabel(groups) {
  const labels = autoLabels(groups);
  return groups.map((g, i) =>
    g.label === labels[i] ? g : { ...g, label: labels[i] },
  );
}

// ---------------------------------------------------------------------------
// Small helpers shared by the read-model and the edit operations
// ---------------------------------------------------------------------------

/** A teacher is qualified for a group when it has no subject, or the teacher lists that subject. */
function isQualified(teacher, group) {
  return (
    !group.subjectId || (teacher.qualifications || []).includes(group.subjectId)
  );
}

const ok = (data) => ({ data, error: null });
const fail = (data, error) => ({ data, error });
const findGroup = (data, id) => (data.groups || []).find((g) => g.id === id);
const findTeacher = (data, id) =>
  (data.teachers || []).find((t) => t.id === id);
const seatsOf = (data, groupId) =>
  (data.assignments || []).filter((a) => a.groupId === groupId);

// ---------------------------------------------------------------------------
// Read-model: the board
// ---------------------------------------------------------------------------

function compareRows(a, b) {
  return (
    streamRank(a.stream) - streamRank(b.stream) ||
    (a.classIds.length === 0) - (b.classIds.length === 0) ||
    naturalCompare(a.classIds.join(","), b.classIds.join(",")) ||
    naturalCompare(a.name, b.name)
  );
}

/**
 * @param {any} data
 * @param {"subject"|"level"} [arrange]
 */
function buildBoard(data, arrange = "subject") {
  const rawGroups = Array.isArray(data?.groups) ? data.groups : [];
  // Before the board owns the groups, a name the HOD typed (a custom group, a
  // label override) must still show as typed, not be replaced by an auto-name.
  const groups = data?.groupsFrozen
    ? rawGroups
    : markTypedLabels(data, rawGroups);
  const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
  const teacherById = new Map((data?.teachers || []).map((t) => [t.id, t]));
  const names = autoLabels(groups);
  const threshold = bigThreshold(data);

  const bandGroupIds = new Map();
  for (const g of groups) {
    if (!g.bandId) continue;
    if (!bandGroupIds.has(g.bandId)) bandGroupIds.set(g.bandId, new Set());
    bandGroupIds.get(g.bandId).add(g.id);
  }

  const cards = new Map();
  groups.forEach((g, i) => {
    const name = names[i];
    const seats = assignments
      .filter((a) => a.groupId === g.id)
      .map((a, index) => {
        const t = teacherById.get(a.teacherId);
        return {
          index,
          teacherId: a.teacherId,
          teacherName: t ? t.name : a.teacherId,
          locked: Boolean(a.locked),
          placeholder: Boolean(t && t.isPlaceholder),
          qualified: t ? isQualified(t, g) : true,
        };
      });

    const warnings = [];
    if (seats.length < g.teachersNeeded) {
      warnings.push(
        `Needs ${g.teachersNeeded - seats.length} more teacher(s).`,
      );
    }
    for (const s of seats) {
      if (!s.qualified)
        warnings.push(`${s.teacherName} isn't qualified for this subject.`);
      const inBand = g.bandId ? bandGroupIds.get(g.bandId) : null;
      if (
        inBand &&
        assignments.some(
          (a) =>
            a.teacherId === s.teacherId &&
            a.groupId !== g.id &&
            inBand.has(a.groupId),
        )
      ) {
        warnings.push(
          `${s.teacherName} is also teaching another group in this band at the same time.`,
        );
      }
    }

    const classIds = Array.isArray(g.classIds) ? g.classIds : [];
    const row = {
      groupId: g.id,
      name,
      level: g.level,
      block: g.block,
      subjectId: g.subjectId || null,
      periods: g.periods,
      isBig: g.periods >= threshold,
      stream: g.stream || "",
      classIds,
      teachersNeeded: g.teachersNeeded,
      note: g.note || "",
      manualLabel: Boolean(g.manualLabel),
      seats,
      complete: seats.length >= g.teachersNeeded,
      warnings,
    };
    const key = `${g.level}|${g.block}`;
    if (!cards.has(key)) {
      cards.set(key, {
        key,
        level: g.level,
        block: g.block,
        title: `${g.block} · Sec ${g.level}`,
        rows: [],
      });
    }
    cards.get(key).rows.push(row);
  });
  for (const card of cards.values()) card.rows.sort(compareRows);

  const bySubject = arrange === "subject";
  const sections = new Map();
  for (const card of cards.values()) {
    const key = bySubject ? card.block : String(card.level);
    if (!sections.has(key)) {
      sections.set(key, {
        key,
        title: bySubject ? card.block : `Sec ${card.level}`,
        cards: [],
      });
    }
    sections.get(key).cards.push(card);
  }
  const out = [...sections.values()].sort(
    bySubject
      ? (a, c) =>
          blockSortKey(a.key) - blockSortKey(c.key) ||
          a.key.localeCompare(c.key)
      : (a, c) => Number(a.key) - Number(c.key),
  );
  out.forEach((s) =>
    s.cards.sort(
      bySubject
        ? (a, c) => a.level - c.level
        : (a, c) =>
            blockSortKey(a.block) - blockSortKey(c.block) ||
            a.block.localeCompare(c.block),
    ),
  );
  return { arrange, sections: out };
}

export { groupLabel, autoLabels, relabel, isQualified, buildBoard };
```

(Some imports at the top, and the `ok`/`fail`/`findGroup`/`findTeacher`/`seatsOf` helpers, are not used until Tasks 4-6. That is fine in an ES module. The `export { ... }` block at the bottom of this file **grows**: every later task's Step 3 says which names to add to it, so each task's tests can run on their own.)

- [ ] **Step 4: Run to confirm pass**

Run: `node --test tests/unit/board.test.js` → PASS.

- [ ] **Step 5: Commit** — propose `feat(board): read-model with consistent group names, sorting and row warnings`.

---

### Task 4: Group edit operations

**Files:**

- Modify: `src/board.js`, `tests/unit/board.test.js`

**Interfaces:**

- Produces (all return `{data, error}`): `addGroup(data, {level, subjectId, id})`, `deleteGroup(data, groupId)`, `duplicateGroup(data, groupId, newId)`, `splitGroup(data, groupId, idFn)`, `combineGroups(data, groupIds, {stream?})`, `updateGroup(data, groupId, patch)` where `patch` keys are any of `periods, teachersNeeded, note, stream, classIds, label`, `clearGroupSeats(data, groupId)`, `rebuildFromSetup(data) -> {data, droppedCount}`.
- Every group op sets `groupsFrozen: true` and relabels.

- [ ] **Step 1: Write the failing tests.** Append to `tests/unit/board.test.js`:

```js
// --- group operations ----------------------------------------------------

test("addGroup(): adds a group that sorts next to its siblings and freezes the board", () => {
  const out = b.addGroup(fixture(), {
    level: 3,
    subjectId: "G2_PHY",
    id: "gNew",
  });
  assert.equal(out.error, null);
  assert.equal(out.data.groupsFrozen, true);
  const added = out.data.groups.find((g) => g.id === "gNew");
  assert.equal(added.periods, 6);
  assert.equal(added.block, "Phy");
  assert.equal(added.stream, "G2");
  assert.equal(added.label, "S3 Phy G2");
  const phy = b
    .buildBoard(out.data, "subject")
    .sections.find((s) => s.key === "Phy");
  assert.deepEqual(
    phy.cards[0].rows.map((r) => r.groupId),
    ["g1", "g2", "gNew", "g3"],
  );
  assertPlain(out.data);
});

test("addGroup(): refuses an unknown subject without changing anything", () => {
  const data = fixture();
  const out = b.addGroup(data, { level: 3, subjectId: "nope", id: "x" });
  assert.match(out.error, /subject/i);
  assert.equal(out.data, data);
});

test("deleteGroup(): removes the group and its assignments", () => {
  const data = fixture();
  data.assignments = [{ teacherId: "t1", groupId: "g1", locked: false }];
  const out = b.deleteGroup(data, "g1");
  assert.equal(
    out.data.groups.some((g) => g.id === "g1"),
    false,
  );
  assert.deepEqual(out.data.assignments, []);
  assertPlain(out.data);
});

test("duplicateGroup(): inserts an unassigned copy straight after the original", () => {
  const data = fixture();
  data.assignments = [{ teacherId: "t1", groupId: "g1", locked: false }];
  const out = b.duplicateGroup(data, "g1", "g1b");
  assert.deepEqual(
    out.data.groups.map((g) => g.id),
    ["g1", "g1b", "g2", "g3", "g4"],
  );
  assert.equal(out.data.assignments.length, 1);
  assert.equal(out.data.groups[1].label, "S3 Phy G2 (3E1) #2");
});

test("splitGroup(): one group per class; the first keeps the original id and its teacher", () => {
  const data = fixture();
  data.groups[0] = grp("g1", 3, "Phy", "G2", ["3E1", "3E2"], "G2_PHY", 6, {
    bandId: "b1",
    band: "b1",
  });
  data.assignments = [{ teacherId: "t1", groupId: "g1", locked: false }];
  let n = 0;
  const out = b.splitGroup(data, "g1", () => `new${++n}`);
  assert.deepEqual(
    out.data.groups.slice(0, 2).map((g) => [g.id, g.classIds, g.bandId]),
    [
      ["g1", ["3E1"], null],
      ["new1", ["3E2"], null],
    ],
  );
  assert.deepEqual(out.data.assignments, [
    { teacherId: "t1", groupId: "g1", locked: false },
  ]);
  assertPlain(out.data);
});

test("splitGroup(): refuses a group with one class", () => {
  const out = b.splitGroup(fixture(), "g1", () => "x");
  assert.match(out.error, /only one class/);
});

test("combineGroups(): merges classes into the first group and drops the others' assignments", () => {
  const data = fixture();
  data.assignments = [
    { teacherId: "t1", groupId: "g1", locked: false },
    { teacherId: "t2", groupId: "g2", locked: false },
  ];
  const out = b.combineGroups(data, ["g1", "g2"], {});
  assert.deepEqual(
    out.data.groups.map((g) => g.id),
    ["g1", "g3", "g4"],
  );
  assert.deepEqual(out.data.groups[0].classIds, ["3E1", "3E2"]);
  assert.equal(out.data.groups[0].label, "S3 Phy G2 (3E1+3E2)");
  assert.deepEqual(out.data.assignments, [
    { teacherId: "t1", groupId: "g1", locked: false },
  ]);
});

test("combineGroups(): refuses different subjects", () => {
  const out = b.combineGroups(fixture(), ["g1", "g3"], {});
  assert.match(out.error, /same subject and level/);
});

test("updateGroup(): lowering teachersNeeded trims seats; periods must be a whole number", () => {
  const data = fixture();
  data.groups[0] = { ...data.groups[0], teachersNeeded: 2 };
  data.assignments = [
    { teacherId: "t1", groupId: "g1", locked: false },
    { teacherId: "t2", groupId: "g1", locked: false },
  ];
  const out = b.updateGroup(data, "g1", { teachersNeeded: 1 });
  assert.deepEqual(
    out.data.assignments.map((a) => a.teacherId),
    ["t1"],
  );
  assert.match(
    b.updateGroup(data, "g1", { periods: "abc" }).error,
    /whole number/,
  );
});

test("updateGroup(): a typed name becomes manual; clearing it goes back to the auto name", () => {
  const named = b.updateGroup(fixture(), "g1", { label: "Special" });
  assert.equal(named.data.groups[0].label, "Special");
  assert.equal(named.data.groups[0].manualLabel, true);
  const cleared = b.updateGroup(named.data, "g1", { label: "  " });
  assert.equal(cleared.data.groups[0].label, "S3 Phy G2 (3E1)");
  assert.equal("manualLabel" in cleared.data.groups[0], false);
  assertPlain(cleared.data);
});

test("updateGroup(): changing the stream also changes the category and the name", () => {
  const out = b.updateGroup(fixture(), "g1", { stream: "G3" });
  assert.equal(out.data.groups[0].category, "G3");
  assert.equal(out.data.groups[0].label, "S3 Phy G3 (3E1)");
});

test("the first edit on an unfrozen file keeps a typed custom-group name", () => {
  const sample = loadSample();
  const other = sample.groups.find((g) => g.id !== "g-custom-enrich").id;
  const out = b.deleteGroup(sample, other);
  const custom = out.data.groups.find((g) => g.id === "g-custom-enrich");
  assert.equal(custom.label, "Enrichment: Chem Research Club");
  assert.equal(custom.manualLabel, true);
  assertPlain(out.data);
});

test("clearGroupSeats(): removes every teacher from one group", () => {
  const data = fixture();
  data.assignments = [
    { teacherId: "t1", groupId: "g1", locked: false },
    { teacherId: "t2", groupId: "g2", locked: false },
  ];
  const out = b.clearGroupSeats(data, "g1");
  assert.deepEqual(out.data.assignments, [
    { teacherId: "t2", groupId: "g2", locked: false },
  ]);
});

test("rebuildFromSetup(): freezes, renames, keeps typed custom labels and reports dropped assignments", () => {
  const { data, droppedCount } = b.rebuildFromSetup(loadSample());
  assert.equal(data.groupsFrozen, true);
  assert.equal(droppedCount, 0);
  const custom = data.groups.find((g) => g.id === "g-custom-enrich");
  assert.equal(custom.label, "Enrichment: Chem Research Club");
  assert.equal(custom.manualLabel, true);
  for (const g of data.groups)
    if (!g.manualLabel) assert.match(g.label, /^S\d /);
  assert.deepEqual(validate(data), []);
  assertPlain(data);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test tests/unit/board.test.js` → the new tests FAIL (`b.addGroup is not a function`).

- [ ] **Step 3: Implement.** Append the code below to `src/board.js` (above the `export { ... }` block), then add these names to that export block: `addGroup, deleteGroup, duplicateGroup, splitGroup, combineGroups, updateGroup, clearGroupSeats, rebuildFromSetup`.

```js
// ---------------------------------------------------------------------------
// Group operations (all freeze the board's group list and relabel)
// ---------------------------------------------------------------------------

function withGroups(data, groups, assignments = data.assignments || []) {
  // The first structural edit is the moment the board takes the groups over:
  // protect typed names (e.g. the sample's custom "Enrichment" group) once.
  const kept = data.groupsFrozen ? groups : markTypedLabels(data, groups);
  return { ...data, groupsFrozen: true, groups: relabel(kept), assignments };
}

/** @param {any} data @param {{level:number, subjectId:string, id:string}} opts */
function addGroup(data, { level, subjectId, id }) {
  const subject = (data.subjects || []).find((s) => s.id === subjectId);
  if (!subject)
    return fail(data, "Pick a subject first, then press Add group.");
  if (!Number.isInteger(level))
    return fail(data, "Pick a level first, then press Add group.");
  const group = {
    id,
    level,
    block: blockFromDiscipline(subject.discipline) || "Other",
    label: "",
    periods: subject.periods,
    band: null,
    teachersNeeded: 1,
    category: subject.stream || "",
    note: "",
    subjectId: subject.id,
    discipline: subject.discipline || "",
    stream: subject.stream || "",
    classIds: [],
    bandId: null,
  };
  return ok(withGroups(data, [...(data.groups || []), group]));
}

function deleteGroup(data, groupId) {
  if (!findGroup(data, groupId))
    return fail(data, "That group no longer exists.");
  return ok(
    withGroups(
      data,
      data.groups.filter((g) => g.id !== groupId),
      (data.assignments || []).filter((a) => a.groupId !== groupId),
    ),
  );
}

function duplicateGroup(data, groupId, newId) {
  const i = (data.groups || []).findIndex((g) => g.id === groupId);
  if (i === -1) return fail(data, "That group no longer exists.");
  const groups = [...data.groups];
  groups.splice(i + 1, 0, { ...groups[i], id: newId });
  return ok(withGroups(data, groups));
}

/** One group per class. The first keeps the original id (and its teacher). */
function splitGroup(data, groupId, idFn) {
  const i = (data.groups || []).findIndex((g) => g.id === groupId);
  if (i === -1) return fail(data, "That group no longer exists.");
  const { manualLabel, ...base } = data.groups[i];
  const classIds = base.classIds || [];
  if (classIds.length < 2) {
    return fail(
      data,
      "This group has only one class, so there is nothing to split.",
    );
  }
  const parts = classIds.map((c, k) => ({
    ...base,
    id: k === 0 ? base.id : idFn(),
    classIds: [c],
    band: null,
    bandId: null,
  }));
  const groups = [...data.groups];
  groups.splice(i, 1, ...parts);
  return ok(withGroups(data, groups));
}

/** Merge groups of the same subject and level into the first one. */
function combineGroups(data, groupIds, { stream } = {}) {
  const picked = groupIds.map((id) => findGroup(data, id)).filter(Boolean);
  if (picked.length < 2)
    return fail(data, "Pick at least two groups to combine.");
  if (new Set(picked.map((g) => `${g.level}|${g.subjectId}`)).size !== 1) {
    return fail(
      data,
      "Only groups of the same subject and level can be combined.",
    );
  }
  const [first, ...rest] = picked;
  const dropIds = new Set(rest.map((g) => g.id));
  const classIds = [...new Set(picked.flatMap((g) => g.classIds || []))].sort(
    naturalCompare,
  );
  const nextStream = stream === undefined ? first.stream || "" : stream;
  const merged = {
    ...first,
    classIds,
    band: null,
    bandId: null,
    stream: nextStream,
    category: nextStream,
  };
  return ok(
    withGroups(
      data,
      data.groups
        .filter((g) => !dropIds.has(g.id))
        .map((g) => (g.id === first.id ? merged : g)),
      (data.assignments || []).filter((a) => !dropIds.has(a.groupId)),
    ),
  );
}

/** @param {any} patch any of periods, teachersNeeded, note, stream, classIds, label */
function updateGroup(data, groupId, patch) {
  const group = findGroup(data, groupId);
  if (!group) return fail(data, "That group no longer exists.");
  const next = { ...group };
  if ("periods" in patch) {
    const n = Number(patch.periods);
    if (!Number.isInteger(n) || n < 1)
      return fail(data, "Periods must be a whole number of 1 or more.");
    next.periods = n;
  }
  if ("teachersNeeded" in patch) {
    const n = Number(patch.teachersNeeded);
    if (!Number.isInteger(n) || n < 1)
      return fail(data, "Teachers needed must be a whole number of 1 or more.");
    next.teachersNeeded = n;
  }
  if ("note" in patch) next.note = String(patch.note);
  if ("stream" in patch) {
    next.stream = String(patch.stream);
    next.category = next.stream;
  }
  if ("classIds" in patch)
    next.classIds = [...patch.classIds].sort(naturalCompare);
  if ("label" in patch) {
    const typed = String(patch.label).trim();
    if (typed) {
      next.label = typed;
      next.manualLabel = true;
    } else {
      delete next.manualLabel;
    }
  }
  const groups = data.groups.map((g) => (g.id === groupId ? next : g));
  const seats = seatsOf(data, groupId).slice(0, next.teachersNeeded);
  const others = (data.assignments || []).filter((a) => a.groupId !== groupId);
  return ok(withGroups(data, groups, [...others, ...seats]));
}

function clearGroupSeats(data, groupId) {
  if (!findGroup(data, groupId))
    return fail(data, "That group no longer exists.");
  return ok({
    ...data,
    assignments: (data.assignments || []).filter((a) => a.groupId !== groupId),
  });
}

/**
 * Throw away the board's groups and regenerate them from Subjects/Classes/
 * Bands. Groups whose label the HOD typed (custom groups, label overrides)
 * keep it.
 * @returns {{data:any, droppedCount:number}}
 */
function rebuildFromSetup(data) {
  const { data: rebuilt, droppedCount } = rebuildGroups(data);
  const groups = markTypedLabels(data, rebuilt.groups);
  return {
    data: { ...rebuilt, groupsFrozen: true, groups: relabel(groups) },
    droppedCount,
  };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test tests/unit/board.test.js` → PASS.

- [ ] **Step 5: Commit** — propose `feat(board): add, delete, duplicate, split, combine and edit groups`.

---

### Task 5: Seat operations (assign, move, swap, lock)

**Files:**

- Modify: `src/board.js`, `tests/unit/board.test.js`

**Interfaces:**

- Produces: `assignSeat(data, groupId, seatIndex, teacherId)` (empty `teacherId` clears the seat), `assignToTeacher(data, from, teacherId)` where `from = {groupId, seatIndex}`, `dropSeat(data, from, to)` (moves into an empty seat, swaps with a filled one), `toggleLock(data, groupId, seatIndex)`. All return `{data, error}`. Over-cap is allowed (shown as a warning in the tally); unqualified, locked, duplicate-on-group and no-free-seat are refused.

- [ ] **Step 1: Write the failing tests.** Append to `tests/unit/board.test.js`:

```js
// --- seat operations -------------------------------------------------------

const A = (teacherId, groupId, locked = false) => ({
  teacherId,
  groupId,
  locked,
});

test("assignSeat(): puts a qualified teacher in a seat as an unlocked assignment", () => {
  const out = b.assignSeat(fixture(), "g1", 0, "t1");
  assert.equal(out.error, null);
  assert.deepEqual(out.data.assignments, [A("t1", "g1")]);
  assertPlain(out.data);
});

test("assignSeat(): refuses an unqualified teacher with a plain-language reason", () => {
  const data = fixture();
  const out = b.assignSeat(data, "g3", 0, "t2");
  assert.match(out.error, /Ben isn't qualified/);
  assert.equal(out.data, data);
});

test("assignSeat(): refuses the same teacher twice on one group, and a seat beyond teachersNeeded", () => {
  const data = fixture();
  data.groups[0] = { ...data.groups[0], teachersNeeded: 2 };
  const once = b.assignSeat(data, "g1", 0, "t1").data;
  assert.match(b.assignSeat(once, "g1", 1, "t1").error, /already teaching/);
  assert.match(b.assignSeat(data, "g2", 1, "t1").error, /only 1 seat/);
});

test("assignSeat(): an empty teacher id clears the seat; a locked seat can still be cleared", () => {
  const data = fixture();
  data.assignments = [A("t1", "g1", true)];
  assert.deepEqual(b.assignSeat(data, "g1", 0, "").data.assignments, []);
});

test("assignSeat(): allows going over cap (the tally warns instead)", () => {
  const data = fixture();
  data.assignments = [A("t3", "g4")]; // HOD cap 10, group is 12 periods
  assert.equal(b.assignSeat(fixture(), "g4", 0, "t3").error, null);
  assert.equal(b.assignSeat(data, "g4", 0, "t3").error, null);
});

test("dropSeat(): swaps two filled seats and unlocks both", () => {
  const data = fixture();
  data.assignments = [A("t1", "g1"), A("t2", "g2")];
  const out = b.dropSeat(
    data,
    { groupId: "g1", seatIndex: 0 },
    { groupId: "g2", seatIndex: 0 },
  );
  assert.equal(out.error, null);
  assert.deepEqual(out.data.assignments, [A("t2", "g1"), A("t1", "g2")]);
});

test("dropSeat(): moves into an empty seat", () => {
  const data = fixture();
  data.assignments = [A("t1", "g1")];
  const out = b.dropSeat(
    data,
    { groupId: "g1", seatIndex: 0 },
    { groupId: "g2", seatIndex: 0 },
  );
  assert.deepEqual(out.data.assignments, [A("t1", "g2")]);
});

test("dropSeat(): refuses a swap that would put someone on a subject they are not qualified for", () => {
  const data = fixture();
  data.assignments = [A("t2", "g1"), A("t1", "g3")];
  const out = b.dropSeat(
    data,
    { groupId: "g1", seatIndex: 0 },
    { groupId: "g3", seatIndex: 0 },
  );
  assert.match(out.error, /isn't qualified/);
  assert.equal(out.data, data);
});

test("dropSeat(): refuses to move a locked seat or to drop onto one", () => {
  const data = fixture();
  data.assignments = [A("t1", "g1", true), A("t2", "g2")];
  assert.match(
    b.dropSeat(
      data,
      { groupId: "g1", seatIndex: 0 },
      { groupId: "g2", seatIndex: 0 },
    ).error,
    /locked/,
  );
  assert.match(
    b.dropSeat(
      data,
      { groupId: "g2", seatIndex: 0 },
      { groupId: "g1", seatIndex: 0 },
    ).error,
    /locked/,
  );
});

test("dropSeat(): dropping a seat on itself or inside its own group changes nothing", () => {
  const data = fixture();
  data.assignments = [A("t1", "g1")];
  const out = b.dropSeat(
    data,
    { groupId: "g1", seatIndex: 0 },
    { groupId: "g1", seatIndex: 0 },
  );
  assert.equal(out.error, null);
  assert.equal(out.data, data);
});

test("dropSeat(): into a co-taught group fills its free seat; none free is refused", () => {
  const data = fixture();
  data.groups[1] = { ...data.groups[1], teachersNeeded: 2 };
  data.assignments = [A("t1", "g1"), A("t2", "g2")];
  const moved = b.dropSeat(
    data,
    { groupId: "g1", seatIndex: 0 },
    { groupId: "g2", seatIndex: 1 },
  );
  assert.deepEqual(
    moved.data.assignments
      .filter((a) => a.groupId === "g2")
      .map((a) => a.teacherId)
      .sort(),
    ["t1", "t2"],
  );
  const full = fixture();
  full.assignments = [A("t1", "g1")];
  assert.match(
    b.dropSeat(
      full,
      { groupId: "g1", seatIndex: 0 },
      { groupId: "g2", seatIndex: 1 },
    ).error,
    /no free seat/,
  );
});

test("assignToTeacher(): moves a seat to another teacher, refusing a locked or unqualified one", () => {
  const data = fixture();
  data.assignments = [A("t1", "g3")];
  assert.match(
    b.assignToTeacher(data, { groupId: "g3", seatIndex: 0 }, "t2").error,
    /isn't qualified/,
  );
  data.assignments = [A("t1", "g1", true)];
  assert.match(
    b.assignToTeacher(data, { groupId: "g1", seatIndex: 0 }, "t2").error,
    /locked/,
  );
  data.assignments = [A("t1", "g1")];
  assert.deepEqual(
    b.assignToTeacher(data, { groupId: "g1", seatIndex: 0 }, "t2").data
      .assignments,
    [A("t2", "g1")],
  );
});

test("toggleLock(): flips the lock on a filled seat and refuses an empty one", () => {
  const data = fixture();
  data.assignments = [A("t1", "g1")];
  assert.equal(b.toggleLock(data, "g1", 0).data.assignments[0].locked, true);
  assert.match(b.toggleLock(data, "g2", 0).error, /Nothing to lock/);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test tests/unit/board.test.js` → new tests FAIL (`b.assignSeat is not a function`).

- [ ] **Step 3: Implement.** Append to `src/board.js` (above the `export { ... }` block), then add `assignSeat, assignToTeacher, dropSeat, toggleLock` to that export block:

```js
// ---------------------------------------------------------------------------
// Seat operations
// ---------------------------------------------------------------------------

/** Replace one group's assignments, keeping every other group's untouched. */
function withGroupSeats(data, groupId, seats) {
  const others = (data.assignments || []).filter((a) => a.groupId !== groupId);
  return { ...data, assignments: [...others, ...seats] };
}

/** teacherId "" clears the seat. Going over cap is allowed; the tally flags it. */
function assignSeat(data, groupId, seatIndex, teacherId) {
  const group = findGroup(data, groupId);
  if (!group) return fail(data, "That group no longer exists.");
  const seats = seatsOf(data, groupId);
  if (!teacherId) {
    if (!seats[seatIndex]) return ok(data);
    return ok(
      withGroupSeats(
        data,
        groupId,
        seats.filter((_, i) => i !== seatIndex),
      ),
    );
  }
  const teacher = findTeacher(data, teacherId);
  if (!teacher) return fail(data, "That teacher no longer exists.");
  const name = group.label || groupId;
  if (!isQualified(teacher, group)) {
    return fail(
      data,
      `${teacher.name} isn't qualified for ${name}. Tick that subject for them on the Teachers tab, or pick someone else.`,
    );
  }
  if (seatIndex >= group.teachersNeeded) {
    return fail(
      data,
      `${name} has only ${group.teachersNeeded} seat(s). Raise "Teachers needed" in the group's details first.`,
    );
  }
  if (seats.some((a, i) => a.teacherId === teacherId && i !== seatIndex)) {
    return fail(data, `${teacher.name} is already teaching ${name}.`);
  }
  const next = [...seats];
  next[seatIndex] = { teacherId, groupId, locked: false };
  return ok(withGroupSeats(data, groupId, next.filter(Boolean)));
}

/** Drag a seat onto a teacher in the tally. */
function assignToTeacher(data, from, teacherId) {
  const seat = seatsOf(data, from.groupId)[from.seatIndex];
  if (!seat) return fail(data, "Nothing to move there.");
  if (seat.locked)
    return fail(data, "That seat is locked. Untick its lock first.");
  return assignSeat(data, from.groupId, from.seatIndex, teacherId);
}

/** Move into an empty seat, or swap with a filled one. Both end up unlocked. */
function dropSeat(data, from, to) {
  const fromSeat = seatsOf(data, from.groupId)[from.seatIndex];
  if (!fromSeat) return fail(data, "Nothing to move there.");
  if (from.groupId === to.groupId) return ok(data);
  const toGroup = findGroup(data, to.groupId);
  const fromGroup = findGroup(data, from.groupId);
  if (!toGroup || !fromGroup) return fail(data, "That group no longer exists.");
  const toSeat = seatsOf(data, to.groupId)[to.seatIndex];
  if (fromSeat.locked || (toSeat && toSeat.locked)) {
    return fail(data, "That seat is locked. Untick its lock first.");
  }
  const mover = findTeacher(data, fromSeat.teacherId);
  if (mover && !isQualified(mover, toGroup)) {
    return fail(data, `${mover.name} isn't qualified for ${toGroup.label}.`);
  }
  if (
    seatsOf(data, to.groupId).some(
      (a) => a !== toSeat && a.teacherId === fromSeat.teacherId,
    )
  ) {
    return fail(
      data,
      `${mover ? mover.name : "That teacher"} is already teaching ${toGroup.label}.`,
    );
  }
  if (toSeat) {
    const other = findTeacher(data, toSeat.teacherId);
    if (other && !isQualified(other, fromGroup)) {
      return fail(
        data,
        `${other.name} isn't qualified for ${fromGroup.label}.`,
      );
    }
    if (
      seatsOf(data, from.groupId).some(
        (a) => a !== fromSeat && a.teacherId === toSeat.teacherId,
      )
    ) {
      return fail(
        data,
        `${other ? other.name : "That teacher"} is already teaching ${fromGroup.label}.`,
      );
    }
    return ok({
      ...data,
      assignments: data.assignments.map((a) =>
        a === fromSeat
          ? { ...a, teacherId: toSeat.teacherId, locked: false }
          : a === toSeat
            ? { ...a, teacherId: fromSeat.teacherId, locked: false }
            : a,
      ),
    });
  }
  if (seatsOf(data, to.groupId).length >= toGroup.teachersNeeded) {
    return fail(data, `${toGroup.label} has no free seat.`);
  }
  return ok({
    ...data,
    assignments: [
      ...data.assignments.filter((a) => a !== fromSeat),
      { teacherId: fromSeat.teacherId, groupId: to.groupId, locked: false },
    ],
  });
}

function toggleLock(data, groupId, seatIndex) {
  const seat = seatsOf(data, groupId)[seatIndex];
  if (!seat) return fail(data, "Nothing to lock there. Pick a teacher first.");
  return ok({
    ...data,
    assignments: data.assignments.map((a) =>
      a === seat ? { ...a, locked: !a.locked } : a,
    ),
  });
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `node --test tests/unit/board.test.js` → PASS.

- [ ] **Step 5: Commit** — propose `feat(board): assign, move, swap and lock seats with plain-language refusals`.

---

### Task 6: Live teacher tally

**Files:**

- Modify: `src/board.js`, `tests/unit/board.test.js`

**Interfaces:**

- Produces: `buildTally(data) -> { rows: TallyRow[], totals }` where
  `TallyRow = { teacherId, name, roleName, isPlaceholder, cap, load, pct, big, small, classes, preps, statusKind: "ok"|"warn"|"over"|"placeholder", statusText, warnings: string[], groups }` and
  `totals = { demand, capacity, groupCount, groupsFilled, seatsTotal, seatsFilled, unfilledSeats, placeholderSeats, spreadPct, teachersOverCap, teachersNeedingCap }`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/unit/board.test.js`:

```js
// --- tally -----------------------------------------------------------------

test("buildTally(): load, percent, big/small, classes and status per teacher", () => {
  const data = fixture();
  data.assignments = [
    A("t1", "g1"),
    A("t1", "g3"),
    A("t2", "g2"),
    A("t3", "g4"),
  ];
  const { rows } = b.buildTally(data);
  const amy = rows.find((r) => r.teacherId === "t1");
  assert.deepEqual(
    [amy.load, amy.cap, amy.pct, amy.big, amy.small, amy.classes],
    [12, 20, 60, 0, 2, 2],
  );
  assert.equal(amy.statusKind, "ok");
  assert.equal(amy.statusText, "Room for 8p");
  const cat = rows.find((r) => r.teacherId === "t3");
  assert.equal(cat.statusKind, "over");
  assert.match(cat.statusText, /Over cap by 2/);
});

test("buildTally(): flags exact big/small counts and max groups that are not met", () => {
  const data = fixture();
  data.teachers[0] = {
    ...data.teachers[0],
    bigCount: 1,
    smallCount: 0,
    maxGroups: 1,
  };
  data.assignments = [A("t1", "g1"), A("t1", "g3")];
  const amy = b.buildTally(data).rows.find((r) => r.teacherId === "t1");
  assert.equal(amy.statusKind, "warn");
  assert.match(amy.warnings.join(" "), /Wants 1 big \(has 0\)/);
  assert.match(amy.warnings.join(" "), /Wants 0 small \(has 2\)/);
  assert.match(amy.warnings.join(" "), /Max 1 classes \(has 2\)/);
});

test("buildTally(): totals compare demand with capacity and report the spread", () => {
  const data = fixture();
  data.assignments = [
    A("t1", "g1"),
    A("t1", "g3"),
    A("t2", "g2"),
    A("t3", "g4"),
  ];
  const { totals } = b.buildTally(data);
  assert.equal(totals.demand, 30);
  assert.equal(totals.capacity, 50);
  assert.equal(totals.unfilledSeats, 0);
  assert.equal(totals.spreadPct, 90); // Cat 120% vs Ben 30%
  assert.equal(totals.teachersOverCap.length, 1);
});

test("buildTally(): placeholders are listed but left out of capacity and spread", () => {
  const data = fixture();
  data.teachers.push({
    id: "t9",
    name: "New",
    roleId: "teacher",
    capOverride: null,
    qualifications: [],
    isPlaceholder: true,
  });
  const { rows, totals } = b.buildTally(data);
  assert.equal(
    rows.find((r) => r.teacherId === "t9").statusKind,
    "placeholder",
  );
  assert.equal(totals.capacity, 50);
});

test("buildTally(): an empty school gives no rows and zero totals", () => {
  const { rows, totals } = b.buildTally({
    teachers: [],
    groups: [],
    assignments: [],
    roles: [],
  });
  assert.deepEqual(rows, []);
  assert.equal(totals.demand, 0);
  assert.equal(totals.spreadPct, 0);
});

test("buildTally(): a stale assignment does not throw", () => {
  const data = fixture();
  data.assignments = [A("ghost", "g1"), A("t1", "gone")];
  assert.doesNotThrow(() => b.buildTally(data));
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test tests/unit/board.test.js` → FAIL (`b.buildTally is not a function`).

- [ ] **Step 3: Implement.** Append to `src/board.js`:

```js
// ---------------------------------------------------------------------------
// Read-model: the live teacher tally
// ---------------------------------------------------------------------------

/** @param {any} data */
function buildTally(data) {
  const teacherById = new Map((data?.teachers || []).map((t) => [t.id, t]));
  const rows = buildTeacherView(data).map((r) => {
    const t = teacherById.get(r.teacherId) || {};
    const classes = r.groups.length;
    const warnings = [];
    if (!r.isPlaceholder) {
      if (r.overCap) warnings.push(`Over cap by ${r.load - r.cap} period(s)`);
      if (isSet(t.bigCount) && r.big !== t.bigCount)
        warnings.push(`Wants ${t.bigCount} big (has ${r.big})`);
      if (isSet(t.smallCount) && r.small !== t.smallCount)
        warnings.push(`Wants ${t.smallCount} small (has ${r.small})`);
      if (isSet(t.maxGroups) && classes > t.maxGroups)
        warnings.push(`Max ${t.maxGroups} classes (has ${classes})`);
    }
    let statusKind = "ok";
    let statusText = r.cap > 0 ? `Room for ${r.cap - r.load}p` : "No cap set";
    if (r.isPlaceholder) {
      statusKind = "placeholder";
      statusText = "Placeholder";
    } else if (r.overCap) {
      statusKind = "over";
      statusText = warnings[0];
    } else if (warnings.length > 0) {
      statusKind = "warn";
      statusText = warnings[0];
    } else if (r.cap > 0 && r.load === r.cap) {
      statusText = "At cap";
    }
    return {
      teacherId: r.teacherId,
      name: r.name,
      roleName: r.roleName,
      isPlaceholder: r.isPlaceholder,
      cap: r.cap,
      load: r.load,
      pct: r.cap > 0 ? Math.round((r.load / r.cap) * 100) : 0,
      big: r.big,
      small: r.small,
      classes,
      preps: r.preps,
      statusKind,
      statusText,
      warnings,
      groups: r.groups,
    };
  });

  const summary = buildSummary(data);
  const real = rows.filter((r) => !r.isPlaceholder && r.cap > 0);
  const pcts = real.map((r) => r.pct);
  const demand = (data?.groups || []).reduce(
    (sum, g) => sum + g.periods * g.teachersNeeded,
    0,
  );
  return {
    rows,
    totals: {
      demand,
      capacity: real.reduce((sum, r) => sum + r.cap, 0),
      groupCount: summary.totalGroups,
      groupsFilled: summary.groupsFilled,
      seatsTotal: summary.seatsTotal,
      seatsFilled: summary.seatsFilled,
      unfilledSeats: summary.seatsTotal - summary.seatsFilled,
      placeholderSeats: summary.placeholderSeats,
      spreadPct: pcts.length > 0 ? Math.max(...pcts) - Math.min(...pcts) : 0,
      teachersOverCap: summary.teachersOverCap,
      teachersNeedingCap: summary.teachersUnderRole,
    },
  };
}

export {
  groupLabel,
  autoLabels,
  relabel,
  isQualified,
  buildBoard,
  buildTally,
  addGroup,
  deleteGroup,
  duplicateGroup,
  splitGroup,
  combineGroups,
  updateGroup,
  clearGroupSeats,
  rebuildFromSetup,
  assignSeat,
  assignToTeacher,
  dropSeat,
  toggleLock,
};
```

The file must end with exactly one `export { ... }` block, and it must match the one above. (It already has `groupLabel` to `buildBoard` from Task 3, the group operations from Task 4 and the seat operations from Task 5; this step adds `buildTally`.)

- [ ] **Step 4: Run to confirm pass**

Run: `node --test tests/unit/board.test.js` → PASS. Then `npm test` → PASS.

- [ ] **Step 5: Commit** — propose `feat(board): live per-teacher tally with totals and fairness spread`.

---

### Task 7: Setup tabs stop overwriting the board; confirmed rebuild button

**Files:**

- Modify: `src/setup.js`, `src/ui/subjects.js:27-36`, `src/ui/classes.js:19-28`, `src/ui/bands.js:18-27`, `index.html` (Classes and Bands panels)
- Create: `src/ui/rebuild.js`
- Test: `tests/unit/setup.test.js` (append)

**Interfaces:**

- Produces: `applySetupEdit(next) -> { data, droppedCount, frozen }` in `src/setup.js`; `wireRebuildButtons()` in `src/ui/rebuild.js` (buttons `#btn-rebuild-groups-classes`, `#btn-rebuild-groups-bands`).

- [ ] **Step 1: Write the failing tests.** Add at the top of `tests/unit/setup.test.js` (a second import from the same module is fine):

```js
import { applySetupEdit } from "../../src/setup.js";
```

Append at the bottom:

```js
// --- applySetupEdit ----------------------------------------------------------

test("applySetupEdit() leaves groups alone once the board owns them", () => {
  const data = {
    subjects: [],
    classes: [],
    bands: [],
    groups: [{ id: "keep" }],
    assignments: [],
    groupsFrozen: true,
  };
  const out = applySetupEdit(data);
  assert.equal(out.frozen, true);
  assert.equal(out.data, data);
  assert.equal(out.droppedCount, 0);
});

test("applySetupEdit() still rebuilds groups before the board has taken over", () => {
  const data = {
    subjects: [],
    classes: [],
    bands: [],
    groups: [{ id: "stale" }],
    assignments: [{ groupId: "stale", teacherId: "t", locked: false }],
  };
  const out = applySetupEdit(data);
  assert.equal(out.frozen, false);
  assert.deepEqual(out.data.groups, []);
  assert.equal(out.droppedCount, 1);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `node --test tests/unit/setup.test.js` → FAIL (`applySetupEdit` is not exported).

- [ ] **Step 3: Implement.** In `src/setup.js` add before the export block and add `applySetupEdit` to the export list:

```js
/**
 * What a Subjects/Classes/Bands edit should do to the group list. Until the
 * HOD edits groups on the Board, the old behaviour stands (regenerate). Once
 * the board owns them (`groupsFrozen`), a setup edit leaves the groups alone;
 * the confirmed "Rebuild groups from setup" button is the way back.
 * @param {any} next
 * @returns {{data:any, droppedCount:number, frozen:boolean}}
 */
function applySetupEdit(next) {
  if (next && next.groupsFrozen)
    return { data: next, droppedCount: 0, frozen: true };
  return { ...rebuildGroups(next), frozen: false };
}
```

In each of `src/ui/subjects.js`, `src/ui/classes.js`, `src/ui/bands.js`, change the import `rebuildGroups` to `applySetupEdit` (keep `setupWarnings` in bands.js) and replace the body of that file's `setDataAndRegenerate` with the version below (swap `setSubjectsStatus` for the file's own status function: `setClassesStatus` / `setBandsStatus`):

```js
function setDataAndRegenerate(next) {
  const { data: rebuilt, droppedCount, frozen } = applySetupEdit(next);
  setData(rebuilt);
  setSubjectsStatus(
    frozen
      ? 'Your Board groups were left as they are. Press "Rebuild groups from setup" on the Classes or Bands tab if you want them to follow this change.'
      : droppedCount > 0
        ? `${esc(droppedCount)} assignment(s) were removed because their group no longer exists.`
        : "",
    "info",
  );
}
```

Create `src/ui/rebuild.js`:

```js
// "Rebuild groups from setup": the only way to replace the Board's groups
// with ones regenerated from Subjects/Classes/Bands. Always asks first.

import { getData, setData } from "./store.js";
import { esc } from "./dom.js";
import { rebuildFromSetup } from "../board.js";

const BUTTONS = [
  ["btn-rebuild-groups-classes", "classes-status"],
  ["btn-rebuild-groups-bands", "bands-status"],
];

function wireRebuildButtons() {
  for (const [buttonId, statusId] of BUTTONS) {
    const button = document.getElementById(buttonId);
    if (!button) continue;
    button.addEventListener("click", () => {
      const data = getData();
      const { data: rebuilt, droppedCount } = rebuildFromSetup(data);
      const message =
        `Rebuild groups from setup?\n\nThis replaces the ${(data.groups || []).length} group(s) on the Board with ${rebuilt.groups.length} generated from Subjects, Classes and Bands. ` +
        `${droppedCount} teacher assignment(s) will be removed because their group no longer exists. Your current state is not saved as a version, so press Save version on the Versions tab first if you want to be able to go back.`;
      if (!confirm(message)) return;
      setData(rebuilt);
      const box = document.getElementById(statusId);
      if (box) {
        box.innerHTML = `<div class="status ok">Groups rebuilt from setup. ${esc(droppedCount)} assignment(s) were removed.</div>`;
      }
    });
  }
}

export { wireRebuildButtons };
```

In `index.html`, inside `#panel-classes`, change the first toolbar's button row to also include `<button id="btn-rebuild-groups-classes" class="secondary" title="Replace the Board's groups with ones generated from Subjects, Classes and Bands">Rebuild groups from setup</button>` right after `<button id="btn-generate-classes">Generate classes</button>`. In `#panel-bands`, add `<div class="toolbar"><button id="btn-rebuild-groups-bands" class="secondary" title="Replace the Board's groups with ones generated from Subjects, Classes and Bands">Rebuild groups from setup</button></div>` as the first child. In `src/ui.js` import `wireRebuildButtons` from `./ui/rebuild.js` and call `wireRebuildButtons();` next to `wireBands();`.

Behaviour note: until Task 8's Board edits freeze groups, the old Groups tab still works as before; `groupsFrozen` is only set by board operations.

- [ ] **Step 4: Run to confirm pass**

Run: `node --test tests/unit/setup.test.js` → PASS. Then `npx playwright test tests/e2e/deployment.spec.js` → PASS (sample data is not frozen, so the old flows behave the same).

- [ ] **Step 5: Commit** — propose `feat(setup): keep Board groups when setup changes, add a confirmed rebuild button`.

---

### Task 8: Board screen (read-only render, alongside the old tabs)

**Files:**

- Create: `src/ui/board.js`
- Modify: `index.html` (tab button, panel, CSS), `src/ui.js` (import, `renderAll`, wiring)
- Test: `tests/e2e/board.spec.js` (create)

**Interfaces:**

- Consumes: `buildBoard`, `buildTally` (Tasks 3, 6), `esc`, `getData`.
- Produces: `renderBoard()`, `wireBoard()` exported from `src/ui/board.js`; DOM hooks `#panel-board`, `#board-body`, `#board-tally`, `#board-summary`, `#board-unassigned`, `#board-quickadd`, `#board-toast`; classes `.board-card[data-key]`, `.board-row[data-group-id][data-stream]`, `.seat[data-group-id][data-seat-index]`, `.tally-row[data-teacher-id]`.

- [ ] **Step 1: Write the failing e2e test.** Create `tests/e2e/board.spec.js` (shared helpers are copied from `deployment.spec.js`, which keeps each spec file independent):

```js
import { test, expect } from "@playwright/test";

async function signInAsHod(page, email = "hod@example.com") {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto("/index.html?emulators=1");
    const popupPromise = page.context().waitForEvent("page");
    await page.click("#sign-in-button");
    const popup = await popupPromise;
    await popup.waitForLoadState();
    const existing = popup.locator(`.js-reuse-account:has-text("${email}")`);
    if ((await existing.count()) > 0) {
      await existing.first().click();
    } else {
      await popup.click("#add-account-button");
      await popup.fill("#email-input", email);
      await popup.click("#sign-in");
    }
    try {
      await expect(page.locator("#app-shell")).toBeVisible({
        timeout: attempt < 3 ? 4000 : 10000,
      });
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      await popup.close().catch(() => {});
    }
  }
}

async function readStoredData(page) {
  return page.evaluate(async () => {
    const { getData } = await import("/src/ui/store.js");
    return getData();
  });
}

async function writeStoredData(page, mutate) {
  await page.evaluate(async (src) => {
    const { getData, setData } = await import("/src/ui/store.js");
    const fn = new Function("data", `return (${src})(data);`);
    await setData(fn(getData()));
  }, mutate.toString());
}

async function loadSample(page) {
  await fetch(
    "http://127.0.0.1:8081/emulator/v1/projects/demo-my-deployment-buddy/databases/(default)/documents",
    { method: "DELETE" },
  );
  await signInAsHod(page);
  await page.click("#btn-load-sample");
  await expect(page.locator("#table-teachers tbody tr")).toHaveCount(10);
}

async function openBoard(page) {
  await page.click('nav.tabs button[data-tab="board"]');
  await expect(page.locator("#board-body .board-card").first()).toBeVisible();
}

test.describe("Board", () => {
  test("shows subject cards with rows, seats and a live teacher tally", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    const data = await readStoredData(page);
    await expect(page.locator("#board-body .board-row")).toHaveCount(
      data.groups.length,
    );
    await expect(page.locator("#board-tally .tally-row")).toHaveCount(
      data.teachers.length,
    );
    await expect(page.locator("#board-tally")).toContainText("Amy Lim");
    await expect(page.locator("#board-summary")).toContainText("Demand");
  });

  test("names are consistent and rows inside a card are ordered by stream", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    const names = await page.locator("#board-body .row-name").allTextContents();
    for (const n of names) {
      if (n.startsWith("Enrichment")) continue;
      expect(n).toMatch(/^S\d /);
    }
    const rank = { G1: 1, G2: 2, G3: 3, PURE: 4, "": 5 };
    const cards = page.locator("#board-body .board-card");
    for (let i = 0; i < (await cards.count()); i++) {
      const streams = await cards
        .nth(i)
        .locator(".board-row")
        .evaluateAll((els) => els.map((e) => e.dataset.stream));
      const ranks = streams.map((s) => rank[s] ?? 5);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx playwright test tests/e2e/board.spec.js`
Expected: FAIL (no tab `board`).

- [ ] **Step 3: Implement.**

Create `src/ui/board.js`:

```js
// Board tab: subject cards with one row per group, a seat (teacher picker +
// lock) per teacher needed, and a live per-teacher tally. Rendering only; all
// decisions live in src/board.js. Later tasks add editing, drag-and-drop and
// undo to this same file.

import { getData } from "./store.js";
import { esc } from "./dom.js";
import { buildBoard, buildTally } from "../board.js";

const STREAM_CLASSES = new Set(["G1", "G2", "G3", "PURE"]);

let arrange = "subject"; // "subject" | "level"
let highlightTeacherId = "";

function qualifiedFor(data, row) {
  return (data.teachers || []).filter(
    (t) => !row.subjectId || (t.qualifications || []).includes(row.subjectId),
  );
}

function renderSeat(data, row, idx, tallyById) {
  const seat = row.seats[idx] || null;
  const options = [
    '<option value="">(none)</option>',
    ...qualifiedFor(data, row).map((t) => {
      const r = tallyById.get(t.id);
      const label = r
        ? `${t.name} · ${r.load}/${r.cap} · ${r.big}B ${r.small}S`
        : t.name;
      return `<option value="${esc(t.id)}" ${seat && seat.teacherId === t.id ? "selected" : ""}>${esc(label)}</option>`;
    }),
  ];
  if (seat && !qualifiedFor(data, row).some((t) => t.id === seat.teacherId)) {
    options.push(
      `<option value="${esc(seat.teacherId)}" selected>${esc(seat.teacherName)} (not qualified)</option>`,
    );
  }
  const highlight =
    seat && seat.teacherId === highlightTeacherId ? " highlight" : "";
  const grip =
    seat && !seat.locked
      ? `<span class="grip" draggable="true" title="Drag to move or swap" aria-label="Drag ${esc(seat.teacherName)} to another class">&#10303;</span>`
      : '<span class="grip-spacer"></span>';
  return `
    <div class="seat${seat && seat.locked ? " seat-locked" : ""}${highlight}" data-group-id="${esc(row.groupId)}" data-seat-index="${esc(idx)}">
      ${grip}
      <select data-action="reassign" data-group-id="${esc(row.groupId)}" data-seat-index="${esc(idx)}" aria-label="Teacher for ${esc(row.name)}">${options.join("")}</select>
      <label class="lock-toggle" title="Lock this assignment so Solve never changes it">
        <input type="checkbox" data-action="toggle-lock" data-group-id="${esc(row.groupId)}" data-seat-index="${esc(idx)}" ${seat ? "" : "disabled"} ${seat && seat.locked ? "checked" : ""} />
        &#128274;
      </label>
      <span class="print-name">${esc(seat ? seat.teacherName : "(none)")}${seat && seat.locked ? " &#128274;" : ""}</span>
    </div>`;
}

function renderRow(data, row, tallyById) {
  const stream = STREAM_CLASSES.has(row.stream) ? row.stream : "";
  const seatCount = Math.max(row.teachersNeeded, row.seats.length);
  const seats = Array.from({ length: seatCount }, (_, i) =>
    renderSeat(data, row, i, tallyById),
  ).join("");
  const classes = [
    "board-row",
    stream ? `stream-${stream.toLowerCase()}` : "",
    row.complete ? "" : "row-incomplete",
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <div class="${esc(classes)}" data-group-id="${esc(row.groupId)}" data-stream="${esc(stream)}">
      <div class="row-main">
        <span class="row-name">${esc(row.name)}</span>
        <span class="row-meta">${esc(row.periods)}p <span class="size-badge ${row.isBig ? "big" : ""}">${row.isBig ? "BIG" : "sm"}</span></span>
      </div>
      <div class="row-seats">${seats}</div>
      ${row.note ? `<div class="row-note">${esc(row.note)}</div>` : ""}
      ${row.warnings.length > 0 ? `<ul class="row-warnings">${row.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
    </div>`;
}

function renderBody(data, board, tallyById) {
  if (board.sections.length === 0) {
    return "<p>No groups yet - load the sample school, or set up Subjects, Classes and Bands first.</p>";
  }
  return board.sections
    .map(
      (section) => `
    <section class="board-section">
      <h2>${esc(section.title)}</h2>
      <div class="board-cards">
        ${section.cards
          .map(
            (card) => `
          <div class="board-card" data-key="${esc(card.key)}" data-level="${esc(card.level)}" data-block="${esc(card.block)}">
            <h3>${esc(card.title)}</h3>
            ${card.rows.map((row) => renderRow(data, row, tallyById)).join("")}
          </div>`,
          )
          .join("")}
      </div>
    </section>`,
    )
    .join("");
}

function renderSummary(tally) {
  const t = tally.totals;
  const lines = [];
  if (t.teachersOverCap.length > 0) {
    lines.push(
      `${esc(t.teachersOverCap.length)} teacher(s) are over their load cap: ${t.teachersOverCap.map((x) => `${esc(x.name)} (${esc(x.load)}/${esc(x.cap)})`).join(", ")}. Solve will not accept this while Load cap is ticked - move a class to someone with room, or raise a cap.`,
    );
  }
  if (t.teachersNeedingCap.length > 0) {
    lines.push(
      `${esc(t.teachersNeedingCap.length)} "Others" teacher(s) need a maximum-periods cap entered: ${t.teachersNeedingCap.map((x) => esc(x.name)).join(", ")}.`,
    );
  }
  return `
    <div class="summary-strip">
      <div class="summary-stat"><strong>${esc(t.groupsFilled)} / ${esc(t.groupCount)}</strong><br /><small>Groups filled</small></div>
      <div class="summary-stat"><strong>${esc(t.seatsFilled)} / ${esc(t.seatsTotal)}</strong><br /><small>Seats filled</small></div>
      <div class="summary-stat"><strong>${esc(t.demand)} / ${esc(t.capacity)}</strong><br /><small>Demand / capacity (periods)</small></div>
      <div class="summary-stat"><strong>${esc(t.spreadPct)} pts</strong><br /><small>Load spread (highest - lowest %)</small></div>
      <div class="summary-stat"><strong>${esc(t.placeholderSeats)}</strong><br /><small>Placeholder seat(s)</small></div>
    </div>
    ${lines.length > 0 ? `<div class="status error">${lines.join("<br />")}</div>` : ""}`;
}

function renderTally(tally) {
  if (tally.rows.length === 0) {
    return "<p>No teachers yet - add some on the Teachers tab, or load the sample school.</p>";
  }
  return `
    <table class="tally">
      <thead><tr><th>Teacher</th><th>Periods</th><th title="Big groups">Big</th><th title="Small groups">Small</th><th title="Number of classes">Classes</th><th>Status</th></tr></thead>
      <tbody>
        ${tally.rows
          .map(
            (r) => `
          <tr class="tally-row${r.teacherId === highlightTeacherId ? " selected" : ""}${r.isPlaceholder ? " row-placeholder" : ""}" data-teacher-id="${esc(r.teacherId)}" title="Click to highlight this teacher's classes. Drop a class here to give it to them.">
            <td>${esc(r.name)}<br /><small>${esc(r.roleName)}</small></td>
            <td>${esc(r.load)} / ${esc(r.cap)} <small>(${esc(r.pct)}%)</small>
              <div class="load-bar-track"><div class="load-bar-fill ${r.statusKind === "over" ? "over" : ""}" style="width:${Math.min(100, r.pct)}%"></div></div></td>
            <td>${esc(r.big)}</td>
            <td>${esc(r.small)}</td>
            <td>${esc(r.classes)}</td>
            <td><span class="status-chip ${esc(r.statusKind)}">${esc(r.statusText)}</span></td>
          </tr>`,
          )
          .join("")}
      </tbody>
    </table>`;
}

function renderBoard() {
  const body = document.getElementById("board-body");
  if (!body) return;
  const data = getData();
  const board = buildBoard(data, arrange);
  const tally = buildTally(data);
  const tallyById = new Map(tally.rows.map((r) => [r.teacherId, r]));
  document.getElementById("board-summary").innerHTML = renderSummary(tally);
  body.innerHTML = renderBody(data, board, tallyById);
  document.getElementById("board-tally").innerHTML = renderTally(tally);
  const tray = document.getElementById("board-unassigned");
  if (tray) {
    tray.textContent =
      tally.totals.unfilledSeats > 0
        ? `${tally.totals.unfilledSeats} seat(s) still unassigned. Drop a class here to clear its teacher.`
        : "Every seat is filled. Drop a class here to clear its teacher.";
  }
}

function wireBoard() {
  const panel = document.getElementById("panel-board");
  panel.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "arrange-subject" || action === "arrange-level") {
      arrange = action === "arrange-level" ? "level" : "subject";
      panel
        .querySelectorAll('[data-action^="arrange-"]')
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.action === action),
        );
      renderBoard();
      return;
    }
    const tallyRow = e.target.closest(".tally-row");
    if (tallyRow) {
      const id = tallyRow.dataset.teacherId;
      highlightTeacherId = highlightTeacherId === id ? "" : id;
      renderBoard();
    }
  });
}

export { renderBoard, wireBoard };
```

In `index.html`:

1. Add the tab button after the Versions button: `<button data-tab="board">&#9320; Board</button>` (temporary number; Task 12 renumbers).
2. Add this panel after `#panel-versions`:

```html
<section id="panel-board" class="panel">
  <div class="toolbar board-controls">
    <div class="view-toggle" role="group" aria-label="Arrange the board by">
      <button data-action="arrange-subject" class="active">By subject</button>
      <button data-action="arrange-level">By level</button>
    </div>
  </div>
  <div id="board-summary"></div>
  <div class="board-layout">
    <div id="board-body"></div>
    <aside class="board-side">
      <div id="board-unassigned" class="unassigned-tray"></div>
      <div id="board-tally"></div>
    </aside>
  </div>
  <div
    id="board-toast"
    class="toast"
    role="status"
    aria-live="polite"
    hidden
  ></div>
</section>
```

3. Add CSS before the `@media print` block:

```css
/* Board tab */
.board-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  gap: 16px;
  align-items: start;
}
.board-side {
  position: sticky;
  top: 8px;
  max-height: calc(100vh - 16px);
  overflow: auto;
}
@media (max-width: 1000px) {
  .board-layout {
    grid-template-columns: 1fr;
  }
  .board-side {
    position: static;
    max-height: none;
  }
}
.board-section h2 {
  font-size: 15px;
  margin: 16px 0 8px;
}
.board-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
}
.board-card {
  flex: 1 1 300px;
  min-width: 280px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
}
.board-card h3 {
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 6px;
}
.board-row {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
  margin-bottom: 6px;
  background: #fff;
}
.row-main {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
}
.row-meta {
  font-weight: 400;
  color: var(--muted);
  white-space: nowrap;
}
.size-badge {
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0 4px;
  margin-left: 4px;
}
.size-badge.big {
  background: #fde8e8;
}
.row-note {
  font-size: 12px;
  color: var(--muted);
}
.row-warnings {
  color: var(--warn);
  font-size: 12px;
  margin: 4px 0 0;
  padding-left: 16px;
}
.grip {
  cursor: grab;
  user-select: none;
  width: 1.2em;
  text-align: center;
}
.grip-spacer {
  display: inline-block;
  width: 1.2em;
}
.seat.dragging {
  opacity: 0.4;
}
.seat.highlight,
.tally-row.selected {
  background: var(--locked);
}
.seat-locked select {
  background: var(--locked);
}
.unassigned-tray {
  border: 2px dashed var(--border);
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 8px;
  text-align: center;
  color: var(--muted);
}
.unassigned-tray.over {
  border-color: var(--accent);
}
table.tally {
  font-size: 13px;
}
.tally-row {
  cursor: pointer;
}
.tally-row.drop-target {
  outline: 2px solid var(--accent);
}
.status-chip.over {
  color: var(--danger);
  font-weight: 600;
}
.status-chip.warn {
  color: var(--warn);
}
.status-chip.ok {
  color: var(--ok);
}
.toast {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 16px;
  border-radius: 8px;
  background: #1a1f29;
  color: #fff;
  z-index: 50;
  max-width: 90vw;
}
.toast.error {
  background: var(--danger);
}
```

In `src/ui.js`: add `import { renderBoard, wireBoard } from "./ui/board.js";`, call `renderBoard();` in `renderAll()` after `renderDeployment();`, and `wireBoard();` after `wireDeployment();`.

- [ ] **Step 4: Run to confirm pass**

Run: `npx playwright test tests/e2e/board.spec.js` → PASS. Then open the app with `npm run serve` and the emulators (`npm run emulators`), load the sample, open the Board tab, and check it looks sensible at a wide and a narrow (phone) width.

- [ ] **Step 5: Commit** — propose `feat(ui): add the Board tab with subject cards and a live teacher tally`.

---

### Task 9: Board editing (pickers, locks, add group, details, toasts, big/small setting)

**Files:**

- Modify: `src/ui/board.js`, `index.html` (toolbar)
- Test: `tests/e2e/board.spec.js` (append)

**Interfaces:**

- Consumes: every operation from `src/board.js`, `genId` from `src/ui/dom.js`.
- Produces: in `src/ui/board.js`, `commit(result, successMessage) -> boolean` (the single place that applies an op result: toasts errors, records undo, calls `setData`), and `toast(message, kind)`. Task 11 extends `commit` with undo.

- [ ] **Step 1: Write the failing e2e tests.** Append inside `test.describe("Board", ...)` in `tests/e2e/board.spec.js`:

```js
test("picking a teacher assigns the seat; an unqualified pick is not offered", async ({
  page,
}) => {
  await loadSample(page);
  await openBoard(page);
  const data = await readStoredData(page);
  const g = data.groups.find((x) => x.subjectId === "G1_SCI");
  const select = page.locator(
    `.board-row[data-group-id="${g.id}"] select[data-action="reassign"]`,
  );
  const offered = await select
    .locator("option")
    .evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  expect(offered).not.toContain("t1"); // Amy is not qualified for G1_SCI
  await select.selectOption("t2");
  const after = await readStoredData(page);
  expect(
    after.assignments.some((a) => a.groupId === g.id && a.teacherId === "t2"),
  ).toBe(true);
  await expect(
    page.locator('#board-tally .tally-row[data-teacher-id="t2"]'),
  ).toContainText("6");
});

test("adding a group from a card puts it next to its siblings and freezes the board", async ({
  page,
}) => {
  await loadSample(page);
  await openBoard(page);
  const card = page.locator("#board-body .board-card").first();
  const before = await card.locator(".board-row").count();
  const level = await card.getAttribute("data-level");
  const select = card.locator('select[data-action="add-group-card"]');
  const subjectId = await select.locator("option").nth(1).getAttribute("value");
  await select.selectOption(subjectId);
  await expect(page.locator("#board-toast")).toContainText("Group added");
  await expect(card.locator(".board-row")).toHaveCount(before + 1);
  const data = await readStoredData(page);
  expect(data.groupsFrozen).toBe(true);
  expect(data.groups.at(-1).level).toBe(Number(level));
});

test("a group's details can be edited, duplicated, and deleted after a confirmation", async ({
  page,
}) => {
  await loadSample(page);
  await openBoard(page);
  const row = page.locator("#board-body .board-row").first();
  const id = await row.getAttribute("data-group-id");
  await row.locator('[data-action="toggle-details"]').click();
  await row.locator('input[data-field="periods"]').fill("9");
  await row.locator('input[data-field="periods"]').blur();
  expect(
    (await readStoredData(page)).groups.find((g) => g.id === id).periods,
  ).toBe(9);

  const count = (await readStoredData(page)).groups.length;
  await row.locator('[data-action="duplicate-group"]').click();
  expect((await readStoredData(page)).groups.length).toBe(count + 1);

  page.once("dialog", (d) => d.dismiss());
  await row.locator('[data-action="delete-group"]').click();
  expect((await readStoredData(page)).groups.length).toBe(count + 1);
  page.once("dialog", (d) => d.accept());
  await row.locator('[data-action="delete-group"]').click();
  expect((await readStoredData(page)).groups.length).toBe(count);
});

test("changing the big/small cut-off updates the tally", async ({ page }) => {
  await loadSample(page);
  await openBoard(page);
  await page.fill("#board-big-periods", "6");
  await page.locator("#board-big-periods").blur();
  expect((await readStoredData(page)).settings.bigPeriods).toBe(6);
});

test("Rebuild groups from setup asks first, and rebuilds when confirmed", async ({
  page,
}) => {
  await loadSample(page);
  await openBoard(page);
  const original = (await readStoredData(page)).groups.length;
  const row = page.locator("#board-body .board-row").first();
  await row.locator('[data-action="toggle-details"]').click();
  page.once("dialog", (d) => d.accept());
  await row.locator('[data-action="delete-group"]').click();
  expect((await readStoredData(page)).groups.length).toBe(original - 1);

  await page.click('nav.tabs button[data-tab="classes"]');
  let message = "";
  page.once("dialog", (d) => {
    message = d.message();
    d.dismiss();
  });
  await page.click("#btn-rebuild-groups-classes");
  expect(message).toContain("Rebuild groups from setup");
  expect((await readStoredData(page)).groups.length).toBe(original - 1);

  page.once("dialog", (d) => d.accept());
  await page.click("#btn-rebuild-groups-classes");
  expect((await readStoredData(page)).groups.length).toBe(original);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx playwright test tests/e2e/board.spec.js` → the five new tests FAIL.

- [ ] **Step 3: Implement.** In `index.html`, add to the board toolbar (inside `.board-controls`, after the view toggle):

```html
<span id="board-quickadd" class="quickadd"></span>
<label title="A group with at least this many periods counts as big">
  Big class =
  <input
    id="board-big-periods"
    type="number"
    min="1"
    data-action="set-big-periods"
    style="width: 4em"
  />
  periods or more
</label>
```

In `src/ui/board.js`:

Change the imports and add module state:

```js
import { getData, setData } from "./store.js";
import { esc, genId } from "./dom.js";
import { bigThreshold } from "../data.js";
import {
  buildBoard,
  buildTally,
  addGroup,
  deleteGroup,
  duplicateGroup,
  splitGroup,
  combineGroups,
  updateGroup,
  clearGroupSeats,
  assignSeat,
  toggleLock,
} from "../board.js";

const LEVELS = [1, 2, 3, 4, 5];
const STREAMS = ["", "G1", "G2", "G3", "PURE"];

let openDetailsId = "";
let quickLevel = 3;
let toastTimer = null;
```

Add the feedback and commit helpers:

```js
function toast(message, kind = "ok") {
  const el = document.getElementById("board-toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 5000);
}

/**
 * Apply the result of a board operation. On a refusal, say why and redraw so
 * a dropdown snaps back; otherwise save it. Returns true if it was applied.
 */
function commit(result, successMessage) {
  if (result.error) {
    toast(result.error, "error");
    renderBoard();
    return false;
  }
  if (result.data === getData()) return true;
  setData(result.data);
  if (successMessage) toast(successMessage, "ok");
  return true;
}
```

Add the details editor and the quick-add helpers:

```js
function renderDetails(data, row, card) {
  const classes = (data.classes || []).filter((c) => c.level === row.level);
  const siblings = card.rows.filter(
    (r) => r.groupId !== row.groupId && r.subjectId === row.subjectId,
  );
  const id = esc(row.groupId);
  return `
    <div class="row-details" data-group-id="${id}">
      <label>Name <input data-action="detail-field" data-field="label" data-group-id="${id}" value="${esc(row.manualLabel ? row.name : "")}" placeholder="${esc(row.name)}" /></label>
      <label>Periods <input data-action="detail-field" data-field="periods" data-group-id="${id}" type="number" min="1" value="${esc(row.periods)}" style="width:4em" /></label>
      <label>Teachers needed <input data-action="detail-field" data-field="teachersNeeded" data-group-id="${id}" type="number" min="1" value="${esc(row.teachersNeeded)}" style="width:4em" /></label>
      <label>Stream
        <select data-action="detail-field" data-field="stream" data-group-id="${id}">
          ${STREAMS.map((s) => `<option value="${esc(s)}" ${s === row.stream ? "selected" : ""}>${esc(s || "(none)")}</option>`).join("")}
        </select>
      </label>
      <fieldset class="detail-classes"><legend>Classes in this group</legend>
        ${classes.length === 0 ? "<small>No classes at this level yet.</small>" : classes.map((c) => `<label><input type="checkbox" data-action="detail-class" data-group-id="${id}" value="${esc(c.id)}" ${row.classIds.includes(c.id) ? "checked" : ""} /> ${esc(c.id)}</label>`).join(" ")}
      </fieldset>
      <label>Note <input data-action="detail-field" data-field="note" data-group-id="${id}" value="${esc(row.note)}" /></label>
      <div class="detail-buttons">
        <button data-action="duplicate-group" data-group-id="${id}">Duplicate group</button>
        ${row.classIds.length > 1 ? `<button data-action="split-group" data-group-id="${id}">Split into one group per class</button>` : ""}
        ${siblings.length > 0 ? `<select data-action="combine-with" data-group-id="${id}"><option value="">Combine with…</option>${siblings.map((s) => `<option value="${esc(s.groupId)}">${esc(s.name)}</option>`).join("")}</select>` : ""}
        ${row.seats.length > 0 ? `<button data-action="clear-teachers" data-group-id="${id}">Remove teachers from this group</button>` : ""}
        <button class="danger" data-action="delete-group" data-group-id="${id}">Delete group</button>
      </div>
    </div>`;
}

function subjectsFor(data, level, block) {
  return (data.subjects || []).filter(
    (s) =>
      (s.levels || []).includes(level) &&
      (block === undefined || blockFromDisciplineSafe(s.discipline) === block),
  );
}
```

Add at the top of the file `import { blockFromDiscipline } from "../setup.js";` and define `const blockFromDisciplineSafe = (d) => blockFromDiscipline(d) || "Other";` (used above).

Update `renderRow` to take `(data, row, tallyById, card)`, append a "⋯" button inside `.row-main` before `.row-meta`:

```js
<button
  class="icon"
  data-action="toggle-details"
  data-group-id="${esc(row.groupId)}"
  aria-label="More options for ${esc(row.name)}"
  title="More options"
>
  &#8943;
</button>
```

and append `${openDetailsId === row.groupId ? renderDetails(data, row, card) : ""}` at the end of the row's markup. Update `renderBody` to pass `card` into `renderRow(data, row, tallyById, card)` and add at the end of each card, after the rows:

```js
            ${renderCardAdd(data, card)}
```

with

```js
function renderCardAdd(data, card) {
  const subjects = subjectsFor(data, card.level, card.block);
  if (subjects.length === 0) return "";
  return `<select class="card-add" data-action="add-group-card" data-level="${esc(card.level)}" aria-label="Add a group to ${esc(card.title)}">
    <option value="">+ add group…</option>
    ${subjects.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}
  </select>`;
}

function renderQuickAdd() {
  const box = document.getElementById("board-quickadd");
  if (!box) return;
  const data = getData();
  const chosen = box.querySelector("#quick-subject")?.value || "";
  const subjects = subjectsFor(data, quickLevel);
  box.innerHTML = `
    <label>Level <select id="quick-level" data-action="quick-level">${LEVELS.map((l) => `<option value="${esc(l)}" ${l === quickLevel ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
    <label>Subject <select id="quick-subject">${subjects.map((s) => `<option value="${esc(s.id)}" ${s.id === chosen ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
    <button data-action="quick-add">Add group</button>`;
}
```

In `renderBoard()`, after the tally is rendered, call `renderQuickAdd();` and set the cut-off box:

```js
const big = document.getElementById("board-big-periods");
if (big && document.activeElement !== big) big.value = bigThreshold(data);
```

Replace `wireBoard()` with the full event wiring (keeps the arrange and tally-highlight logic from Task 8):

```js
function groupIdOf(el) {
  return (
    el.dataset.groupId || el.closest("[data-group-id]")?.dataset.groupId || ""
  );
}

function wireBoard() {
  const panel = document.getElementById("panel-board");

  panel.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    const action = el?.dataset.action;
    const data = getData();
    const id = el ? groupIdOf(el) : "";

    if (action === "arrange-subject" || action === "arrange-level") {
      arrange = action === "arrange-level" ? "level" : "subject";
      panel
        .querySelectorAll('[data-action^="arrange-"]')
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.action === action),
        );
      renderBoard();
    } else if (action === "toggle-details") {
      openDetailsId = openDetailsId === id ? "" : id;
      renderBoard();
    } else if (action === "quick-add") {
      const subjectId = document.getElementById("quick-subject")?.value;
      commit(
        addGroup(data, { level: quickLevel, subjectId, id: genId("g") }),
        "Group added.",
      );
    } else if (action === "duplicate-group") {
      commit(duplicateGroup(data, id, genId("g")), "Group duplicated.");
    } else if (action === "split-group") {
      commit(
        splitGroup(data, id, () => genId("g")),
        "Split into one group per class.",
      );
    } else if (action === "clear-teachers") {
      commit(clearGroupSeats(data, id), "Teachers removed from this group.");
    } else if (action === "delete-group") {
      const group = (data.groups || []).find((g) => g.id === id);
      const seats = (data.assignments || []).filter(
        (a) => a.groupId === id,
      ).length;
      const name = group ? group.label : "this group";
      const message =
        seats > 0
          ? `Delete "${name}"?\n\nIts ${seats} teacher assignment(s) will be removed too. You can press Undo last change straight after.`
          : `Delete "${name}"?`;
      if (confirm(message)) {
        openDetailsId = "";
        commit(deleteGroup(data, id), "Group deleted.");
      }
    } else if (!action) {
      const tallyRow = e.target.closest(".tally-row");
      if (tallyRow) {
        const tid = tallyRow.dataset.teacherId;
        highlightTeacherId = highlightTeacherId === tid ? "" : tid;
        renderBoard();
      }
    }
  });

  panel.addEventListener("change", (e) => {
    const el = e.target;
    const action = el.dataset.action;
    const data = getData();
    if (action === "reassign") {
      commit(
        assignSeat(
          data,
          el.dataset.groupId,
          Number(el.dataset.seatIndex),
          el.value,
        ),
      );
    } else if (action === "toggle-lock") {
      commit(
        toggleLock(data, el.dataset.groupId, Number(el.dataset.seatIndex)),
      );
    } else if (action === "add-group-card") {
      if (!el.value) return;
      commit(
        addGroup(data, {
          level: Number(el.dataset.level),
          subjectId: el.value,
          id: genId("g"),
        }),
        "Group added.",
      );
    } else if (action === "quick-level") {
      quickLevel = Number(el.value);
      renderQuickAdd();
    } else if (action === "detail-field") {
      commit(
        updateGroup(data, el.dataset.groupId, { [el.dataset.field]: el.value }),
      );
    } else if (action === "detail-class") {
      const box = el.closest(".row-details");
      const classIds = [
        ...box.querySelectorAll('input[data-action="detail-class"]:checked'),
      ].map((c) => c.value);
      commit(updateGroup(data, el.dataset.groupId, { classIds }));
    } else if (action === "combine-with") {
      if (!el.value) return;
      commit(
        combineGroups(data, [el.dataset.groupId, el.value], {}),
        "Groups combined.",
      );
    } else if (action === "set-big-periods") {
      const n = Number(el.value);
      if (!Number.isInteger(n) || n < 1) {
        toast(
          "Enter a whole number of 1 or more for the big/small cut-off.",
          "error",
        );
        el.value = bigThreshold(data);
        return;
      }
      setData({
        ...data,
        settings: { ...(data.settings || {}), bigPeriods: n },
      });
      toast(`Groups of ${n}+ periods now count as big.`, "ok");
    }
  });
}
```

(`renderBoard` still re-uses `highlightTeacherId` and `arrange` declared in Task 8.) Remember that the global `installBlankNumberRestore` only restores boxes that carry `data-field`; the detail number inputs do, the cut-off box does not (it validates itself above).

- [ ] **Step 4: Run to confirm pass**

Run: `npx playwright test tests/e2e/board.spec.js` → PASS.

- [ ] **Step 5: Commit** — propose `feat(ui): edit groups, seats and the big/small cut-off directly on the Board`.

---

### Task 10: Drag-and-drop

**Files:**

- Modify: `src/ui/board.js`
- Test: `tests/e2e/board.spec.js` (append)

**Interfaces:**

- Consumes: `dropSeat`, `assignToTeacher`, `assignSeat` (Task 5), `commit`/`toast` (Task 9).
- Produces: native HTML5 drag handlers inside `wireBoard()`: drag source `.grip`, drop targets `.seat`, `.board-row`, `.tally-row`, `#board-unassigned`.

- [ ] **Step 1: Write the failing e2e tests.** Append inside the describe block:

```js
async function setUpSwap(page) {
  // t1 Amy and t2 Ben are both qualified for G2_LSS. Put one on each of two G2_LSS groups.
  await writeStoredData(page, (d) => {
    const g2 = d.groups.filter((g) => g.subjectId === "G2_LSS").slice(0, 2);
    return {
      ...d,
      assignments: [
        { teacherId: "t1", groupId: g2[0].id, locked: false },
        { teacherId: "t2", groupId: g2[1].id, locked: false },
      ],
    };
  });
  const d = await readStoredData(page);
  const [a, b] = d.groups.filter((g) => g.subjectId === "G2_LSS").slice(0, 2);
  return [a.id, b.id];
}

test("dragging a teacher onto another class swaps the two", async ({
  page,
}) => {
  await loadSample(page);
  await openBoard(page);
  const [a, b] = await setUpSwap(page);
  await page
    .locator(`.board-row[data-group-id="${a}"] .grip`)
    .dragTo(page.locator(`.board-row[data-group-id="${b}"] .seat`));
  const after = await readStoredData(page);
  expect(after.assignments.find((x) => x.groupId === a).teacherId).toBe("t2");
  expect(after.assignments.find((x) => x.groupId === b).teacherId).toBe("t1");
  await expect(page.locator("#board-toast")).toContainText("Swapped");
});

test("dropping a class on a teacher in the tally gives it to them; the tray clears it", async ({
  page,
}) => {
  await loadSample(page);
  await openBoard(page);
  const [a] = await setUpSwap(page);
  await page
    .locator(`.board-row[data-group-id="${a}"] .grip`)
    .dragTo(page.locator('#board-tally .tally-row[data-teacher-id="t2"]'));
  expect(
    (await readStoredData(page)).assignments.find((x) => x.groupId === a)
      .teacherId,
  ).toBe("t2");
  await page
    .locator(`.board-row[data-group-id="${a}"] .grip`)
    .dragTo(page.locator("#board-unassigned"));
  expect(
    (await readStoredData(page)).assignments.some((x) => x.groupId === a),
  ).toBe(false);
});

test("an unqualified drop is refused with a plain-language message and nothing changes", async ({
  page,
}) => {
  await loadSample(page);
  await openBoard(page);
  await writeStoredData(page, (d) => {
    const lss = d.groups.find((g) => g.subjectId === "G2_LSS");
    const sci = d.groups.find((g) => g.subjectId === "G1_SCI");
    return {
      ...d,
      assignments: [
        { teacherId: "t1", groupId: lss.id, locked: false }, // Amy: LSS only
        { teacherId: "t2", groupId: sci.id, locked: false }, // Ben: LSS + G1_SCI
      ],
    };
  });
  const before = await readStoredData(page);
  const sci = before.groups.find((g) => g.subjectId === "G1_SCI");
  const lss = before.groups.find((g) => g.subjectId === "G2_LSS");
  // Swapping would put Amy on G1_SCI, which she is not qualified for.
  await page
    .locator(`.board-row[data-group-id="${sci.id}"] .grip`)
    .dragTo(page.locator(`.board-row[data-group-id="${lss.id}"] .seat`));
  await expect(page.locator("#board-toast")).toContainText("isn't qualified");
  expect((await readStoredData(page)).assignments).toEqual(before.assignments);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx playwright test tests/e2e/board.spec.js -g "dragging|dropping|unqualified drop"` → FAIL.

- [ ] **Step 3: Implement.** In `src/ui/board.js` import `dropSeat` and `assignToTeacher` (add to the import list from `../board.js`) and `assignSeat` is already imported. Add module state `let dragSource = null;` and these listeners at the end of `wireBoard()`:

```js
panel.addEventListener("dragstart", (e) => {
  const grip = e.target.closest?.(".grip");
  if (!grip) return;
  const seat = grip.closest(".seat");
  dragSource = {
    groupId: seat.dataset.groupId,
    seatIndex: Number(seat.dataset.seatIndex),
  };
  e.dataTransfer.setData("text/plain", JSON.stringify(dragSource));
  e.dataTransfer.effectAllowed = "move";
  seat.classList.add("dragging");
});

panel.addEventListener("dragover", (e) => {
  if (!dragSource) return;
  const target = e.target.closest?.(
    ".seat, .board-row, .tally-row, #board-unassigned",
  );
  if (!target) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  panel
    .querySelectorAll(".drop-target, .over")
    .forEach((n) => n.classList.remove("drop-target", "over"));
  target.classList.add(
    target.id === "board-unassigned" ? "over" : "drop-target",
  );
});

panel.addEventListener("dragend", () => {
  dragSource = null;
  panel
    .querySelectorAll(".dragging, .drop-target, .over")
    .forEach((n) => n.classList.remove("dragging", "drop-target", "over"));
});

panel.addEventListener("drop", (e) => {
  if (!dragSource) return;
  e.preventDefault();
  const from = dragSource;
  dragSource = null;
  panel
    .querySelectorAll(".dragging, .drop-target, .over")
    .forEach((n) => n.classList.remove("dragging", "drop-target", "over"));
  const data = getData();
  const nameOf = (teacherId) =>
    (data.teachers || []).find((t) => t.id === teacherId)?.name ||
    "That teacher";
  const mover = (data.assignments || []).filter(
    (a) => a.groupId === from.groupId,
  )[from.seatIndex];

  const seatEl = e.target.closest(".seat");
  const rowEl = e.target.closest(".board-row");
  const tallyEl = e.target.closest(".tally-row");
  if (e.target.closest("#board-unassigned")) {
    commit(
      assignSeat(data, from.groupId, from.seatIndex, ""),
      mover ? `Removed ${nameOf(mover.teacherId)} from that class.` : "",
    );
  } else if (tallyEl) {
    commit(
      assignToTeacher(data, from, tallyEl.dataset.teacherId),
      `Gave that class to ${nameOf(tallyEl.dataset.teacherId)}.`,
    );
  } else if (seatEl || rowEl) {
    const groupId = (seatEl || rowEl).dataset.groupId;
    let seatIndex;
    if (seatEl) {
      seatIndex = Number(seatEl.dataset.seatIndex);
    } else {
      const filled = (data.assignments || []).filter(
        (a) => a.groupId === groupId,
      ).length;
      const needed =
        (data.groups || []).find((g) => g.id === groupId)?.teachersNeeded ?? 1;
      seatIndex = filled < needed ? filled : 0;
    }
    const target = (data.assignments || []).filter(
      (a) => a.groupId === groupId,
    )[seatIndex];
    commit(
      dropSeat(data, from, { groupId, seatIndex }),
      target
        ? `Swapped ${nameOf(mover?.teacherId)} and ${nameOf(target.teacherId)}.`
        : `Moved ${nameOf(mover?.teacherId)}.`,
    );
  }
});
```

A drop inside the same group returns the data unchanged with no error; `commit` then returns true without a toast, which is correct (nothing to say).

- [ ] **Step 4: Run to confirm pass**

Run: `npx playwright test tests/e2e/board.spec.js` → PASS.

- [ ] **Step 5: Commit** — propose `feat(ui): drag teachers between classes, onto the tally, or to the tray`.

---

### Task 11: Undo/redo, Solve and Print on the Board

**Files:**

- Modify: `src/ui/board.js`, `src/ui.js` (solve wiring), `index.html` (toolbar, print CSS)
- Test: `tests/e2e/board.spec.js` (append)

**Interfaces:**

- Produces: `recordUndoPoint()` exported from `src/ui/board.js` (called by `onSolve` before it applies a solve so a solve can be undone from the Board); undo snapshots hold only `{groups, assignments, groupsFrozen?}`.

- [ ] **Step 1: Write the failing e2e tests.** Append inside the describe block:

```js
test("Undo last change reverses a swap and Redo brings it back", async ({
  page,
}) => {
  await loadSample(page);
  await openBoard(page);
  const [a, b] = await setUpSwap(page);
  await page
    .locator(`.board-row[data-group-id="${a}"] .grip`)
    .dragTo(page.locator(`.board-row[data-group-id="${b}"] .seat`));
  await page.click('[data-action="undo"]');
  let d = await readStoredData(page);
  expect(d.assignments.find((x) => x.groupId === a).teacherId).toBe("t1");
  await page.click('[data-action="redo"]');
  d = await readStoredData(page);
  expect(d.assignments.find((x) => x.groupId === a).teacherId).toBe("t2");
});

test("Ctrl+Z undoes a board change when focus is not in a text box", async ({
  page,
}) => {
  await loadSample(page);
  await openBoard(page);
  const g = (await readStoredData(page)).groups.find(
    (x) => x.subjectId === "G1_SCI",
  );
  await page
    .locator(
      `.board-row[data-group-id="${g.id}"] select[data-action="reassign"]`,
    )
    .selectOption("t2");
  await page.locator("#panel-board h2").first().click();
  await page.keyboard.press("Control+z");
  expect(
    (await readStoredData(page)).assignments.some((x) => x.groupId === g.id),
  ).toBe(false);
});

test("undoing never writes an undefined field and does not touch other tabs' data", async ({
  page,
}) => {
  await loadSample(page);
  await openBoard(page);
  await page
    .locator("#board-body .board-card")
    .first()
    .locator('select[data-action="add-group-card"]')
    .selectOption({ index: 1 });
  await page.click('[data-action="undo"]');
  const d = await readStoredData(page);
  expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  expect(d.teachers.length).toBe(10);
});

test("Solve on the Board fills every seat, and Undo last change reverses the solve", async ({
  page,
}) => {
  await loadSample(page);
  await openBoard(page);
  await page.click("#btn-solve-board");
  await expect(page.locator("#board-solve-status .status.ok")).toContainText(
    "Solved",
    { timeout: 15000 },
  );
  expect((await readStoredData(page)).assignments.length).toBeGreaterThan(0);
  await page.click('[data-action="undo"]');
  expect((await readStoredData(page)).assignments.length).toBe(0);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx playwright test tests/e2e/board.spec.js -g "Undo|Ctrl|undoing|Solve on the Board"` → FAIL.

- [ ] **Step 3: Implement.**

`index.html`, board toolbar (after the cut-off label):

```html
            <button data-action="undo" class="secondary" title="Undo the last Board change (Ctrl+Z)">&#8630; Undo last change</button>
            <button data-action="redo" class="secondary" title="Redo the change you undid (Ctrl+Y)">&#8631; Redo change</button>
            <button id="btn-solve-board" class="primary">Solve</button>
            <button data-action="print" title="Print this board">Print board</button>
          </div>
          <div id="board-solve-status"></div>
```

(Make sure the `</div>` that closes `.board-controls` is that one, and `#board-solve-status` sits just under the toolbar.) In the `@media print` block, replace `#panel-deployment .toolbar,` with `#panel-board .toolbar, #panel-board .board-side .unassigned-tray, .row-details, .card-add, .grip, .row-main .icon,` and add `.board-layout { grid-template-columns: 1fr !important; }`.

`src/ui/board.js`, add:

```js
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

/** Only the board-owned slice is undone, so edits made on other tabs are never reverted. */
function snap(d) {
  const s = { groups: d.groups, assignments: d.assignments };
  if (d.groupsFrozen !== undefined) s.groupsFrozen = d.groupsFrozen;
  return s;
}

function applySnap(d, s) {
  const { groupsFrozen, ...rest } = d; // drop first so an absent field stays absent (Firestore rejects undefined)
  return { ...rest, ...s };
}

/** Remember the current board state so the next change (or a solve) can be undone. */
function recordUndoPoint() {
  undoStack.push(snap(getData()));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

function stepHistory(from, to, doneMessage) {
  const s = from.pop();
  if (!s) {
    toast("Nothing to undo yet.", "error");
    return;
  }
  to.push(snap(getData()));
  setData(applySnap(getData(), s));
  toast(doneMessage, "ok");
}
```

Change `commit` so a successful change records an undo point before saving:

```js
if (result.data === getData()) return true;
recordUndoPoint();
setData(result.data);
```

In the click handler's chain add:

```js
    } else if (action === "undo") {
      stepHistory(undoStack, redoStack, "Undone.");
    } else if (action === "redo") {
      if (redoStack.length === 0) return toast("Nothing to redo.", "error");
      stepHistory(redoStack, undoStack, "Redone.");
    } else if (action === "print") {
      window.print();
```

(For redo, `stepHistory(redoStack, undoStack, ...)` pushes the current state onto the undo stack, which is what we want.) Add the keyboard shortcut at the end of `wireBoard()`:

```js
document.addEventListener("keydown", (e) => {
  if (!panel.classList.contains("active")) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  const key = e.key.toLowerCase();
  if (key === "z" && !e.shiftKey) {
    e.preventDefault();
    stepHistory(undoStack, redoStack, "Undone.");
  } else if (key === "y" || (key === "z" && e.shiftKey)) {
    e.preventDefault();
    stepHistory(redoStack, undoStack, "Redone.");
  }
});
```

Export `recordUndoPoint`: `export { renderBoard, wireBoard, recordUndoPoint };`.

`src/ui.js`:

- import `recordUndoPoint` with the other board imports;
- change `setStatus` to write to both status boxes:

```js
function setStatus(html, kind) {
  const markup = html ? `<div class="status ${kind}">${html}</div>` : "";
  for (const id of ["solve-status", "board-solve-status"]) {
    const box = document.getElementById(id);
    if (box) box.innerHTML = markup;
  }
}
```

- in `onSolve`, disable/enable both buttons: replace `const btn = document.getElementById("btn-solve"); btn.disabled = true;` with `const buttons = ["btn-solve", "btn-solve-board"].map((id) => document.getElementById(id)).filter(Boolean); buttons.forEach((b) => (b.disabled = true));` and in `finally` `buttons.forEach((b) => (b.disabled = false));`;
- call `recordUndoPoint();` immediately before the `await setData({... assignments: result.assignments ...})` call inside `if (result.optimal)`;
- in `wireLayers()` after the existing `btn-solve` listener add `document.getElementById("btn-solve-board").addEventListener("click", onSolve);`.

- [ ] **Step 4: Run to confirm pass**

Run: `npx playwright test tests/e2e/board.spec.js` → PASS. Then manually press "Print board" in the browser and confirm the print preview shows names, not dropdowns.

- [ ] **Step 5: Commit** — propose `feat(ui): undo/redo, Solve and Print on the Board`.

---

### Task 12: Retire the old Groups and Deployment tabs, update tests and docs

**Files:**

- Delete: `src/ui/groups.js`, `src/ui/deployment.js`
- Modify: `index.html`, `src/ui.js`, `tests/e2e/deployment.spec.js`, `CLAUDE.md` (project), the Teachers tab header tooltips in `index.html`
- Keep: `src/view.js` (Excel layout and tests use `buildDeploymentView`), `src/setup.js` (`generateGroups`/`rebuildGroups` still back "Rebuild groups from setup")

**Interfaces:** none new.

- [ ] **Step 1: Update the existing e2e tests first (they now point at removed screens).** In `tests/e2e/deployment.spec.js`:

1. First test: replace the `groups` tab block with

```js
await page.click('nav.tabs button[data-tab="board"]');
await expect(page.locator("#board-body")).toContainText(/S4 Phy G3 \(.*\) #1/);
```

2. Second test ("regenerating classes ..."): rename it "...updates the Board without solving", and replace both `groups` tab blocks:

```js
await page.click('nav.tabs button[data-tab="board"]');
await expect(page.locator("#board-body")).toContainText(/S4 Phy G3 \(.*\) #3/);
```

```js
await page.click('nav.tabs button[data-tab="board"]');
await expect(page.locator("#board-body")).toContainText(/S4 Phy G3 \(.*\) #2/);
await expect(page.locator("#board-body")).not.toContainText(
  /S4 Phy G3 \(.*\) #3/,
);
```

and change the comment to say the Board reflects it because the sample has not been edited on the Board yet. (The sample has no `groupsFrozen`, so regeneration still applies; this is the old-file path.)

3. Third test (solve): replace the block from `// Spot-check the Deployment View` to `// Toggle back to Sheet layout.` + its `expect` with:

```js
await page.click('nav.tabs button[data-tab="board"]');
const printNames = await page
  .locator(".seat .print-name")
  .evaluateAll((els) => els.map((el) => el.textContent.trim()));
expect(printNames.length).toBeGreaterThan(0);
expect(printNames.some((n) => n && n !== "(none)" && n !== "undefined")).toBe(
  true,
);
await expect(page.locator("#board-tally")).toContainText("Amy Lim");
await expect(page.locator("#board-tally thead")).toContainText("Periods");
```

and the later `await page.click('nav.tabs button[data-tab="deployment"]');` (after reload) to `data-tab="board"`.

4. Lock test: both `data-tab="deployment"` clicks become `data-tab="board"`.

(Tests that read `[data-action="reassign"]` / `toggle-lock` keep working: the Board seats use the same attributes.)

- [ ] **Step 2: Run to see the old tabs still present and tests passing**

Run: `npx playwright test tests/e2e/deployment.spec.js tests/e2e/board.spec.js` → PASS (both screens still exist at this point).

- [ ] **Step 3: Remove the old screens.**

`index.html`: delete the `<button data-tab="groups">` and `<button data-tab="deployment">` buttons and the whole `#panel-groups` and `#panel-deployment` sections; delete the now-unused `/* Groups tab */` CSS rules (`.groups-level`, `.groups-level h3`) and the `.deployment-level`, `.deployment-blocks`, `.deployment-block` rules. Renumber the tab buttons so the nav reads: `&#9312; Subjects`, `&#9313; Classes`, `&#9314; Bands`, `&#9315; Teachers`, `&#9316; Board` (move the Board button here, before Solve), `&#9317; Solve`, `&#9318; Versions`. Change the Teachers table header tooltips from "10+ periods" to `the big/small cut-off (set on the Board tab, default 10 periods)`.

`src/ui.js`: remove the imports of `./ui/groups.js` and `./ui/deployment.js`, the calls `renderGroups()`, `renderDeployment()`, `wireGroups()`, `wireDeployment()`.

Delete `src/ui/groups.js` and `src/ui/deployment.js`.

- [ ] **Step 4: Update the project docs.** In the project `CLAUDE.md` Key files table, add rows for `src/board.js` ("Pure Board logic: group names, board/tally read-models, group and seat edit operations. Unit-testable without a browser.") and `src/ui/board.js` ("Board tab: rendering, drag-and-drop, undo/redo."), and replace the sentence under `src/data.js` about persistence unchanged. Add under "Non-negotiables" one bullet: "**The Board owns the group list.** Once any group is edited on the Board (`data.groupsFrozen`), edits on Subjects/Classes/Bands no longer regenerate groups; only the confirmed 'Rebuild groups from setup' button does."

- [ ] **Step 5: Full verification.**

Run: `npm test` → all unit tests PASS.
Run: `npm run test:rules` → PASS (rules untouched).
Run: `npx playwright test` → all e2e specs PASS.
Manual: `npm run serve` + `npm run emulators`; load the sample; on the Board add a group, drag a swap, undo, solve, undo the solve, export to Excel and re-open it, and confirm the Board looks identical and nothing re-solved. Check a phone-width window.

- [ ] **Step 6: Commit** — propose `refactor(ui): retire the Groups and Deployment tabs in favour of the Board`.

---

## Self-Review (done while writing)

**Spec coverage:** data model (Task 1, 2, 4, 7); pure board logic (Tasks 3-6); board UI cards, rows, picker, ⋯ menu, add group, arrange toggle (Tasks 8, 9); drag-and-drop to row, tally and tray, unqualified refused (Task 10); sticky tally, highlight, totals (Tasks 6, 8); undo/redo, Solve on board, print (Task 11); rebuild with confirmation (Task 7); old tabs removed after parity, docs (Task 12); Excel and versions carry the new fields (Task 2); configurable cut-off (Tasks 1, 9). Inline warnings and totals (Tasks 3, 6, 8).

**Type consistency:** `commit(result, message)`, `{data, error}`, `from = {groupId, seatIndex}`, `Row`/`TallyRow` field names are used identically in Tasks 3-11. `groupLabel(group)` takes only the group (the spec said `(data, group)`; the amendment records this).

**Planning amendments to the spec** (recorded at the end of the spec file): (1) the spec's `tag` is the existing `group.stream` (G1/G2/G3/PURE), so no new field; (2) `groupLabel(group)` needs no `data`; (3) `manualLabel` keeps typed names (custom groups) from being overwritten; (4) the group details editor (name, periods, teachers needed, stream, classes, note) is added so the Board fully replaces the old Groups tab; (5) going over a teacher's cap is allowed on the Board and shown as a warning (the old sheet refused it), because swaps pass through states that exceed it and the HOD wants to see the result; (6) a quick-add control in the toolbar so a brand-new subject/level can be started on an empty Board.
