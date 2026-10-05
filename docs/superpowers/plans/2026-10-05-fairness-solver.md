# Fairness Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the solver balance the HOD's fairness priorities (class count, big/small mix, preps, graduating spread) on one common scale, controlled by presets and sliders, with a plain-language "what this solve gave up" report, and retire the `balance` and `stable` layers.

**Architecture:** One new soft layer `classCount` with per-teacher ideal class counts (`idealClassCounts`, typed target > fill-to-cap role > cap share). Four fairness layers (`classCount`, `mix`, `preps`, `graduatingSpread`) take their weights from one setting, `data.settings.fairness` (levels 1-5, weight `4^(level-1)`), via `buildModel`. `balance` and `stable` leave the registry (saved settings for them are ignored). A pure `fairnessReport` feeds the UI.

**Tech Stack:** Native ES modules (no build step), `node --test`, HiGHS WASM (real solver in tests), Playwright + Firebase emulators.

**Spec:** `docs/superpowers/specs/2026-10-05-fairness-solver-design.md`

## Plan amendments (found while reading the code; Task 8 writes them into the spec)

1. **Placeholder avoidance must outrank the fairness weights.** The `placeholder` layer's saved weight is 50, but a `classCount` gap costs up to 256 per class, so the solver would put classes on the "New Teacher" placeholder to even out real teachers' counts. `fairnessWeights` therefore also returns `placeholder = 10 x the largest of the four weights`, and `buildModel` uses it for the `placeholder` layer, ignoring its saved weight.
2. **Test fixtures need a way to set one fairness weight.** Existing layer tests set weights through `layerSettings` (e.g. `ON("preps", 2)`), which is now ignored for the four fairness layers. Task 3 adds `only(layerId, level)` to `tests/unit/layers/rulesFixture.js` and migrates those tests.
3. **Default weight resolution is `settings.fairness` (or the `classCountFirst` default) always**, for the four fairness layers and `placeholder`. The layer on/off toggle still comes from `layerSettings`.

## Global Constraints

- No build step: every file under `src/` stays a native ES module (no bundler, no transpiler, no new dependency).
- No real student/teacher data in the repo; fictional names only.
- Re-opening a saved file or restoring a version never re-solves. Old files without the new fields load unchanged and behave as the `classCountFirst` preset.
- Pure functions are fail-safe: they never throw and never mutate their input; bad input falls back to defaults.
- Constraint names stay `<layerId>_<entityId>`. All new layers are soft (no `HARD_PREFIXES` change).
- All interpolated HTML, including attribute values, goes through `esc()`.
- User rule: do NOT push, and do not commit without the user's approval of the message (the SDD run may be allowed to commit on a local feature branch if the user says so).
- Attribution lines for commits are appended per the session's commit-attribution reminder.

## Review Focus

1. **Old saved deployment**: `layerSettings` still contains `balance` and `stable` (weight 5) and there is no `settings.fairness`: it must validate, round-trip through Excel without gaining keys, build a model with no anchoring and the `classCountFirst` weights (Task 3 and 4 tests).
2. **Degenerate ideals**: every teacher fill-to-cap, zero seats, zero caps, a single teacher, a typed target of 0 or larger than they can reach: `idealClassCounts` returns finite numbers and the solve stays optimal (Task 2 and 3 tests).
3. **Placeholder**: with a placeholder available and real teachers able to cover everything, the solver never uses the placeholder to even out counts (Task 3 test).
4. **Report edge cases**: no assignments, only placeholder assignments, one teacher, a team-taught group: `fairnessReport` never throws and says something sensible (Task 5 tests).
5. **Excel**: a Roles sheet from before this change has no `fillToCap` column, so roles default by id; a blank `targetClasses` cell reads back as absent (Task 1 tests).

---

## File Structure

| File                                                                                                 | Change | Responsibility                                                                          |
| ---------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| `src/data.js`                                                                                        | modify | `FAIRNESS_PRESETS`, `fairnessSettings`, `roleFillsToCap`, `validate` for the new fields |
| `src/excel.js`                                                                                       | modify | round-trip `Roles.fillToCap`, `Teachers.targetClasses`, `Settings` fairness keys        |
| `src/fairness.js`                                                                                    | create | `fairnessWeights`, `FAIRNESS_KEY_BY_LAYER`, `idealClassCounts`, `fairnessReport`        |
| `src/layers/classCount.js`                                                                           | create | soft: distance of each teacher's class count from their ideal                           |
| `src/layers/registry.js`                                                                             | modify | add `classCount`; remove `balance`, `stable`                                            |
| `src/layers/balance.js`, `src/layers/stable.js`, `tests/unit/layers/balance.test.js`                 | delete | retired                                                                                 |
| `src/model.js`                                                                                       | modify | weights for the four fairness layers and `placeholder` come from `fairnessWeights`      |
| `src/ui/teachers.js`, `index.html`                                                                   | modify | Teachers "Target classes" column, Roles "Fill to cap" checkbox                          |
| `src/ui/fairness.js`                                                                                 | create | Fairness emphasis card (presets, sliders)                                               |
| `src/ui.js`                                                                                          | modify | wire the card, hide weight boxes for fairness layers, show the report after Solve       |
| `sample/sample.json`                                                                                 | modify | drop `balance` and `stable` from `layerSettings`, add `classCount`                      |
| `tests/unit/layers/rulesFixture.js` and the layer tests                                              | modify | `only()` helper, migrate off `layerSettings` weights                                    |
| `tests/unit/fairness*.test.js`, `tests/unit/layers/classCount.test.js`, `tests/e2e/fairness.spec.js` | create | tests                                                                                   |
| `CLAUDE.md`, the spec                                                                                | modify | docs (Task 8)                                                                           |

Run commands (repo root, Git Bash): single unit file `node --test tests/unit/<file>.test.js`; full unit run `npm test` (starts the Firestore emulator; needs Java); rules `npm run test:rules`; e2e `npx playwright test` (starts its own server and emulators).

---

### Task 1: Data fields, validation and Excel round trip

**Files:**

- Modify: `src/data.js` (typedefs lines 5-23; helpers after `graduatingSettings`; `validate` roles block ~lines 148-170, teachers `for (const field of [...])` loop, `settings` block; export list)
- Modify: `src/excel.js` (`dataToSheets` Roles/Teachers/Settings, `sheetsToData` roles/teachers/settings)
- Test: `tests/unit/fairness-data.test.js` (create)

**Interfaces:**

- Produces (exported from `src/data.js`):
  - `FAIRNESS_PRESETS: Record<string, {classCount:number, mix:number, preps:number, graduating:number}>` with `classCountFirst` 5/4/3/2, `balanced` 4/4/3/3, `fewerPreps` 4/3/5/2.
  - `fairnessSettings(data) -> { preset:string, levels:{classCount, mix, preps, graduating} }`: preset is a `FAIRNESS_PRESETS` key or `"custom"` (default `classCountFirst`); levels come from the preset unless the preset is `"custom"`, where they come from `data.settings.fairness.levels` (each clamped to a whole 1..5, missing ones from `classCountFirst`).
  - `roleFillsToCap(role) -> boolean`: `role.fillToCap` if it is a boolean, else `true` for role ids `hod` and `sh_st`, else `false`.
- Types: `role.fillToCap?:boolean`; `teacher.targetClasses?:number|null`; `settings.fairness?:{preset:string, levels?:object}`.

- [ ] **Step 1: Write the failing test** — create `tests/unit/fairness-data.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/fairness-data.test.js`
Expected: FAIL (`FAIRNESS_PRESETS` is not exported from `src/data.js`).

- [ ] **Step 3: Implement.**

`src/data.js` typedefs: add `fillToCap?:boolean` to the `Role` typedef and `targetClasses?:number|null` to the `Teacher` typedef.

After `graduatingSettings` add:

```js
const FAIRNESS_PRESETS = {
  classCountFirst: { classCount: 5, mix: 4, preps: 3, graduating: 2 },
  balanced: { classCount: 4, mix: 4, preps: 3, graduating: 3 },
  fewerPreps: { classCount: 4, mix: 3, preps: 5, graduating: 2 },
};
const FAIRNESS_KEYS = ["classCount", "mix", "preps", "graduating"];

/** @param {any} v @param {number} fallback  a whole number 1..5, else the fallback */
function levelOr(v, fallback) {
  return Number.isInteger(v) ? Math.min(5, Math.max(1, v)) : fallback;
}

/**
 * The fairness emphasis: a preset name (or "custom") and the four 1-5 levels.
 * Missing or nonsensical input falls back to "classCountFirst", so old files
 * behave exactly like the default preset.
 * @param {any} data
 * @returns {{preset:string, levels:{classCount:number, mix:number, preps:number, graduating:number}}}
 */
function fairnessSettings(data) {
  const f = data?.settings?.fairness;
  const preset =
    f && (f.preset === "custom" || FAIRNESS_PRESETS[f.preset])
      ? f.preset
      : "classCountFirst";
  if (preset !== "custom")
    return { preset, levels: { ...FAIRNESS_PRESETS[preset] } };
  const base = FAIRNESS_PRESETS.classCountFirst;
  const levels = {};
  for (const k of FAIRNESS_KEYS) levels[k] = levelOr(f?.levels?.[k], base[k]);
  return { preset, levels };
}

/**
 * Should this role be filled close to its cap? An explicit boolean wins;
 * otherwise the HOD and SH/ST roles default to true.
 * @param {any} role
 * @returns {boolean}
 */
function roleFillsToCap(role) {
  if (!role || typeof role !== "object") return false;
  if (typeof role.fillToCap === "boolean") return role.fillToCap;
  return role.id === "hod" || role.id === "sh_st";
}
```

`validate()`: in the roles `forEach`, after the `maxPeriods` check add:

```js
if (typeof r.fillToCap !== "undefined" && typeof r.fillToCap !== "boolean")
  errors.push(`roles[${i}].fillToCap must be true or false.`);
```

change the teachers loop `for (const field of ["bigCount", "smallCount", "maxGroups"])` to include `"targetClasses"`; in the `settings` block (after the graduating checks) add:

```js
if (typeof s.fairness !== "undefined") {
  const f = s.fairness;
  if (!f || typeof f !== "object" || Array.isArray(f)) {
    errors.push("settings.fairness must be an object.");
  } else {
    if (
      typeof f.preset !== "undefined" &&
      f.preset !== "custom" &&
      !FAIRNESS_PRESETS[f.preset]
    )
      errors.push(
        `settings.fairness.preset must be "custom" or one of: ${Object.keys(FAIRNESS_PRESETS).join(", ")}.`,
      );
    if (typeof f.levels !== "undefined") {
      const ok =
        f.levels &&
        typeof f.levels === "object" &&
        FAIRNESS_KEYS.every(
          (k) =>
            typeof f.levels[k] === "undefined" ||
            (Number.isInteger(f.levels[k]) &&
              f.levels[k] >= 1 &&
              f.levels[k] <= 5),
        );
      if (!ok)
        errors.push(
          "settings.fairness.levels must be whole numbers from 1 to 5.",
        );
    }
  }
}
```

and add `FAIRNESS_PRESETS, fairnessSettings, roleFillsToCap,` to the export block.

`src/excel.js`: in `dataToSheets` Roles mapper add `fillToCap: r.fillToCap === undefined ? "" : Boolean(r.fillToCap),`; Teachers mapper add `targetClasses: t.targetClasses ?? "",`; extend the `Settings` array with

```js
      ...(data.settings && data.settings.fairness
        ? [
            { key: "fairnessPreset", value: data.settings.fairness.preset ?? "classCountFirst" },
            ...(data.settings.fairness.levels
              ? [
                  {
                    key: "fairnessLevels",
                    value: ["classCount", "mix", "preps", "graduating"]
                      .map((k) => data.settings.fairness.levels[k] ?? "")
                      .join(", "),
                  },
                ]
              : []),
          ]
        : []),
```

In `sheetsToData`: roles mapper add `...(row.fillToCap === "" || row.fillToCap == null ? {} : { fillToCap: toBool(row.fillToCap) }),`; teachers mapper add `...optionalCount(row, "targetClasses"),`; after the graduating settings handling build the fairness object:

```js
const fairnessPreset = setting("fairnessPreset");
if (fairnessPreset !== undefined && fairnessPreset !== "") {
  const fairness = { preset: String(fairnessPreset) };
  const lv = setting("fairnessLevels");
  if (lv !== undefined && lv !== "") {
    const nums = splitList(lv).map(Number);
    const keys = ["classCount", "mix", "preps", "graduating"];
    if (nums.length === 4 && nums.every((n) => Number.isFinite(n)))
      fairness.levels = Object.fromEntries(keys.map((k, i) => [k, nums[i]]));
  }
  settings.fairness = fairness;
}
```

(this goes before the existing `...(Object.keys(settings).length > 0 ? { settings } : {})` spread).

- [ ] **Step 4: Run to verify it passes, then the neighbours**

Run: `node --test tests/unit/fairness-data.test.js tests/unit/excel.test.js tests/unit/excel-rules.test.js tests/unit/rules-data.test.js tests/unit/data.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — propose `feat(data): add fairness settings, fill-to-cap roles and per-teacher target classes`; wait for approval (or commit if the user has allowed task commits on this branch).

---

### Task 2: `src/fairness.js` — weights and ideal class counts

**Files:**

- Create: `src/fairness.js`, `tests/unit/fairness.test.js`

**Interfaces:**

- Consumes: `fairnessSettings`, `roleFillsToCap`, `effectiveCap` from `src/data.js` (Task 1).
- Produces:
  - `FAIRNESS_KEY_BY_LAYER = { classCount:"classCount", mix:"mix", preps:"preps", graduatingSpread:"graduating" }`
  - `fairnessWeights(data) -> { classCount:number, mix:number, preps:number, graduating:number, placeholder:number }`: each of the four is `4^(level-1)`; `placeholder = 10 * max(the four)`.
  - `idealClassCounts(data) -> Map<teacherId, number>` (placeholder teachers, teachers with no cap and teachers qualified for no group are not in the map).

- [ ] **Step 1: Write the failing test** — `tests/unit/fairness.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fairnessWeights,
  idealClassCounts,
  FAIRNESS_KEY_BY_LAYER,
} from "../../src/fairness.js";

test("weights are 4^(level-1), and placeholder avoidance outranks them", () => {
  const w = fairnessWeights({});
  assert.deepEqual(
    [w.classCount, w.mix, w.preps, w.graduating],
    [256, 64, 16, 4], // classCountFirst 5/4/3/2
  );
  assert.equal(w.placeholder, 2560);
  const custom = fairnessWeights({
    settings: {
      fairness: {
        preset: "custom",
        levels: { classCount: 1, mix: 1, preps: 1, graduating: 1 },
      },
    },
  });
  assert.deepEqual(
    [
      custom.classCount,
      custom.mix,
      custom.preps,
      custom.graduating,
      custom.placeholder,
    ],
    [1, 1, 1, 1, 10],
  );
  assert.equal(
    fairnessWeights({ settings: { fairness: { preset: "balanced" } } })
      .classCount,
    64,
  );
  assert.deepEqual(FAIRNESS_KEY_BY_LAYER, {
    classCount: "classCount",
    mix: "mix",
    preps: "preps",
    graduatingSpread: "graduating",
  });
});

const roles = [
  { id: "teacher", name: "Teacher", maxPeriods: null },
  { id: "hod", name: "HOD", maxPeriods: null },
];
const teacher = (id, cap, over = {}) => ({
  id,
  name: id,
  roleId: "teacher",
  capOverride: cap,
  qualifications: ["A"],
  ...over,
});
const group = (id, periods = 6, teachersNeeded = 1) => ({
  id,
  level: 3,
  block: "A",
  label: id,
  periods,
  teachersNeeded,
  subjectId: "A",
});
const school = (teachers, groups) => ({
  roles,
  teachers,
  groups,
  assignments: [],
});

test("equal caps share the seats evenly", () => {
  const ideals = idealClassCounts(
    school(
      [teacher("a", 60), teacher("b", 60)],
      [1, 2, 3, 4].map((i) => group(`g${i}`)),
    ),
  );
  assert.equal(ideals.get("a"), 2);
  assert.equal(ideals.get("b"), 2);
});

test("unequal caps follow cap share", () => {
  const ideals = idealClassCounts(
    school(
      [teacher("a", 60), teacher("b", 30)],
      [1, 2, 3, 4, 5, 6].map((i) => group(`g${i}`)),
    ),
  );
  assert.equal(ideals.get("a"), 4);
  assert.equal(ideals.get("b"), 2);
});

test("a fill-to-cap role is pulled toward its cap; the rest share what is left", () => {
  // 8 groups x 6 periods: avgP 6. HOD cap 18 -> 3 classes; the other teacher gets 5.
  const ideals = idealClassCounts(
    school(
      [teacher("h", 18, { roleId: "hod" }), teacher("a", 100)],
      [1, 2, 3, 4, 5, 6, 7, 8].map((i) => group(`g${i}`)),
    ),
  );
  assert.equal(ideals.get("h"), 3);
  assert.equal(ideals.get("a"), 5);
});

test("a typed target wins over everything and the rest share the remainder", () => {
  const ideals = idealClassCounts(
    school(
      [
        teacher("a", 100),
        teacher("b", 100, { targetClasses: 1 }),
        teacher("h", 18, { roleId: "hod", targetClasses: 0 }),
      ],
      [1, 2, 3, 4].map((i) => group(`g${i}`)),
    ),
  );
  assert.equal(ideals.get("b"), 1);
  assert.equal(ideals.get("h"), 0);
  assert.equal(ideals.get("a"), 3);
});

test("a team-taught group counts as one seat per teacher", () => {
  const ideals = idealClassCounts(
    school(
      [teacher("a", 60), teacher("b", 60)],
      [group("g1", 6, 2), group("g2", 6, 2)],
    ),
  );
  assert.equal(ideals.get("a") + ideals.get("b"), 4);
});

test("degenerate input gives finite numbers, never NaN or a throw", () => {
  assert.equal(idealClassCounts({}).size, 0);
  assert.equal(idealClassCounts(school([], [group("g1")])).size, 0);
  assert.equal(idealClassCounts(school([teacher("a", 60)], [])).size, 0); // no seats
  // Placeholder, no-cap and unqualified teachers are left out.
  const d = school(
    [
      teacher("a", 60),
      teacher("p", 60, { isPlaceholder: true }),
      teacher("n", null),
      teacher("u", 60, { qualifications: ["B"] }),
    ],
    [group("g1"), group("g2")],
  );
  const ideals = idealClassCounts(d);
  assert.deepEqual([...ideals.keys()], ["a"]);
  assert.equal(ideals.get("a"), 2);
  // Every teacher fill-to-cap and more than the seats: finite, the remainder floors at 0.
  const all = idealClassCounts(
    school(
      [
        teacher("h1", 600, { roleId: "hod" }),
        teacher("h2", 600, { roleId: "hod" }),
      ],
      [group("g1"), group("g2")],
    ),
  );
  for (const v of all.values()) assert.ok(Number.isFinite(v) && v >= 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/fairness.test.js`
Expected: FAIL (cannot find module `src/fairness.js`).

- [ ] **Step 3: Implement `src/fairness.js`:**

```js
// Fairness: the one place that turns the HOD's fairness emphasis into numbers.
// Pure and fail-safe (never throws, never mutates). Used by buildModel (weights),
// the classCount layer (ideal class counts) and the report after a Solve.

import { effectiveCap, fairnessSettings, roleFillsToCap } from "./data.js";

/** Which `fairnessSettings().levels` key each layer's weight comes from. */
const FAIRNESS_KEY_BY_LAYER = {
  classCount: "classCount",
  mix: "mix",
  preps: "preps",
  graduatingSpread: "graduating",
};

/**
 * Objective weights: 4^(level-1) per fairness measure, so one step of
 * difference means the higher priority usually wins a trade-off and two steps
 * almost always do. `placeholder` is 10x the largest of them: using the "New
 * Teacher" placeholder must never be cheaper than a real teacher's fairness gap.
 * @param {any} data
 * @returns {{classCount:number, mix:number, preps:number, graduating:number, placeholder:number}}
 */
function fairnessWeights(data) {
  const { levels } = fairnessSettings(data);
  const w = {
    classCount: 4 ** (levels.classCount - 1),
    mix: 4 ** (levels.mix - 1),
    preps: 4 ** (levels.preps - 1),
    graduating: 4 ** (levels.graduating - 1),
  };
  return {
    ...w,
    placeholder: 10 * Math.max(w.classCount, w.mix, w.preps, w.graduating),
  };
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * The ideal number of classes for each real teacher:
 *  1. a typed `targetClasses` is used as-is;
 *  2. a teacher whose role is "fill to cap" gets cap / (average periods per seat);
 *  3. the remaining seats (never below 0) are shared by everyone else in
 *     proportion to cap.
 * A team-taught group is one seat per teacher it needs. Placeholder teachers,
 * teachers with no cap and teachers qualified for none of the groups are left out.
 * @param {any} data
 * @returns {Map<string, number>}
 */
function idealClassCounts(data) {
  const out = new Map();
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const teachers = Array.isArray(data?.teachers) ? data.teachers : [];
  const roles = Array.isArray(data?.roles) ? data.roles : [];

  let seats = 0;
  let seatPeriods = 0;
  for (const g of groups) {
    const need =
      isNum(g?.teachersNeeded) && g.teachersNeeded > 0 ? g.teachersNeeded : 1;
    seats += need;
    seatPeriods += (isNum(g?.periods) ? g.periods : 0) * need;
  }
  if (seats === 0) return out;
  const avgPeriods = seatPeriods / seats;

  const subjects = new Set(groups.map((g) => g?.subjectId).filter(Boolean));
  const members = teachers.filter((t) => {
    if (!t || t.isPlaceholder) return false;
    if (!(effectiveCap(data, t) > 0)) return false;
    return (Array.isArray(t.qualifications) ? t.qualifications : []).some((s) =>
      subjects.has(s),
    );
  });

  const roleById = new Map(roles.map((r) => [r?.id, r]));
  let fixed = 0;
  const sharers = [];
  for (const t of members) {
    if (isNum(t.targetClasses) && t.targetClasses >= 0) {
      out.set(t.id, t.targetClasses);
      fixed += t.targetClasses;
    } else if (roleFillsToCap(roleById.get(t.roleId)) && avgPeriods > 0) {
      const ideal = effectiveCap(data, t) / avgPeriods;
      out.set(t.id, ideal);
      fixed += ideal;
    } else {
      sharers.push(t);
    }
  }

  const rest = Math.max(0, seats - fixed);
  const capSum = sharers.reduce((sum, t) => sum + effectiveCap(data, t), 0);
  for (const t of sharers) {
    out.set(t.id, capSum > 0 ? (rest * effectiveCap(data, t)) / capSum : 0);
  }
  return out;
}

export { FAIRNESS_KEY_BY_LAYER, fairnessWeights, idealClassCounts };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/unit/fairness.test.js tests/unit/fairness-data.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — propose `feat(fairness): add fairness weights and ideal class counts`; wait for approval.

---

### Task 3: `classCount` layer, weights from the fairness setting, test migration

**Files:**

- Create: `src/layers/classCount.js`, `tests/unit/layers/classCount.test.js`
- Modify: `src/layers/registry.js`, `src/model.js` (`weightOf`, lines 31-36), `tests/unit/layers/rulesFixture.js`, and every existing test that sets a fairness-layer weight through `layerSettings` (found by running the suite; known: `mix-preps.test.js`, `preps-level.test.js`, `graduating.test.js`, `groupCount.test.js`, `formTeacher.test.js`, `deny.test.js`, `model.test.js`)

**Interfaces:**

- Consumes: `idealClassCounts`, `fairnessWeights`, `FAIRNESS_KEY_BY_LAYER` (Task 2).
- Produces: layer `classCount` (soft, `defaultWeight: 256`), rows `classCount_hi_<teacherId>` (`sum - dev <= ideal`) and `classCount_lo_<teacherId>` (`sum + dev >= ideal`), objective `weight * dev`, helper variables `cc_dev_<n>` (continuous). `buildModel` resolves the weights of `classCount`, `mix`, `preps`, `graduatingSpread` (from `fairnessWeights(data)[FAIRNESS_KEY_BY_LAYER[id]]`) and `placeholder` (`fairnessWeights(data).placeholder`), ignoring their saved `layerSettings` weights; the on/off toggle still comes from `layerSettings`. `rulesFixture.js` exports `only(layerId, level)`.

- [ ] **Step 1: Update the shared fixture and write the failing tests.**

`tests/unit/layers/rulesFixture.js`: add `roles` to `fixture()`'s options (`roles = [{ id: "r", name: "R", maxPeriods: null }]`, used instead of the hard-coded roles), and replace the `QUIET` line and add `only`:

```js
const FAIR_LAYERS = ["classCount", "mix", "preps", "graduatingSpread"];
const KEY = {
  classCount: "classCount",
  mix: "mix",
  preps: "preps",
  graduatingSpread: "graduating",
};
// Soft layers that would otherwise pull the answer around in a test.
export const QUIET = [...FAIR_LAYERS.map(OFF), OFF("balance"), OFF("stable")];

/**
 * Switch every fairness layer off except `layerId`, and give it `level` (1-5)
 * in the fairness setting. Spread into fixture(): `fixture({ ..., ...only("preps", 3) })`.
 */
export function only(layerId, level = 3) {
  const levels = {
    classCount: 1,
    mix: 1,
    preps: 1,
    graduating: 1,
    [KEY[layerId]]: level,
  };
  return {
    layerSettings: [
      ...FAIR_LAYERS.filter((id) => id !== layerId).map(OFF),
      OFF("balance"),
      OFF("stable"),
    ],
    settings: { fairness: { preset: "custom", levels } },
  };
}
```

(`fixture()` already passes `settings` through when given.)

Create `tests/unit/layers/classCount.test.js`:

```js
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

test("adds a hi and a lo row per teacher with an ideal, plus a continuous deviation", () => {
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
  }
  assert.equal(m.extraBinaryVars.length, 0); // deviations stay continuous
  assert.ok(m.objectiveTerms.some((t) => t.coef === 256));
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

test("a disabled classCount layer, placeholders and teachers with no eligible group add nothing", () => {
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
});
```

Note the placeholder test passes its own `layerSettings`, which overrides `only()`'s because the spread `...only(...)` comes last in `run`; fix this by building `layerSettings` explicitly: in that test call `solveModel(buildModel(fixture({ roles, teachers, groups: groups(4), settings: only("classCount", 5).settings, layerSettings: [...] })))` instead of `run(...)`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/layers/classCount.test.js`
Expected: FAIL (no `classCount_` rows; `only` not exported yet fails earlier until Step 1's fixture edit is saved).

- [ ] **Step 3: Implement.**

`src/layers/classCount.js`:

```js
// L-classCount (soft): each real teacher should hold about their ideal number
// of classes (src/fairness.js idealClassCounts: typed target, else fill-to-cap
// role, else cap share). Per teacher, dev >= |classes - ideal| via two rows;
// the objective is weight x dev, so the weight is "cost per class off ideal".
// A team-taught group is one variable per teacher, so it counts once for each.
// The dev variables are not declared Binary, so they stay continuous and >= 0
// (same as mix.js). Placeholders and teachers with no eligible group are skipped.

import { idealClassCounts } from "../fairness.js";

const classCountLayer = {
  id: "classCount",
  name: "Fair class counts",
  kind: "soft",
  defaultWeight: 256, // the real weight comes from the Fairness emphasis (src/fairness.js)
  describe() {
    return "Give each teacher about their fair number of classes: in proportion to cap, a typed target, or filled close to cap for roles set to do so.";
  },
  build(ctx) {
    const weight = ctx.weight("classCount");
    if (!weight) return;
    const ideals = idealClassCounts(ctx.data);
    let n = 0;
    for (const t of ctx.data.teachers) {
      if (t.isPlaceholder || !ideals.has(t.id)) continue;
      const terms = [];
      for (const g of ctx.data.groups) {
        const varName = ctx.x(t.id, g.id);
        if (varName) terms.push({ coef: 1, varName });
      }
      if (terms.length === 0) continue;
      const ideal = ideals.get(t.id);
      const dev = `cc_dev_${n++}`;
      ctx.addConstraint(
        `classCount_hi_${t.id}`,
        [...terms, { coef: -1, varName: dev }],
        "<=",
        ideal,
      );
      ctx.addConstraint(
        `classCount_lo_${t.id}`,
        [...terms, { coef: 1, varName: dev }],
        ">=",
        ideal,
      );
      ctx.addObjectiveTerm(weight, dev);
    }
  },
};

export { classCountLayer };
```

`src/layers/registry.js`: `import { classCountLayer } from "./classCount.js";` and add `classCountLayer,` right after `mixLayer,` in `LAYERS`.

`src/model.js`: add `import { fairnessWeights, FAIRNESS_KEY_BY_LAYER } from "./fairness.js";` and replace `weightOf` with:

```js
const weightOf = (layerId) => {
  // The fairness layers and placeholder avoidance take their weight from the
  // Fairness emphasis (src/fairness.js), not from layerSettings.
  if (layerId === "placeholder") return fairnessWeights(data).placeholder;
  const key = FAIRNESS_KEY_BY_LAYER[layerId];
  if (key) return fairnessWeights(data)[key];
  const layer = layers.find((l) => l.id === layerId);
  const s = settingsById.get(layerId);
  if (s && typeof s.weight === "number") return s.weight;
  return layer ? layer.defaultWeight : 0;
};
```

- [ ] **Step 4: Run the new test, then find and migrate every test the change broke**

Run: `node --test tests/unit/layers/classCount.test.js` (expect PASS), then `npm test`.
Expected: failures in tests that (a) set a fairness-layer weight through `layerSettings` (`ON("mix", n)`, `ON("preps", n)`, `ON("graduatingSpread", n)` or a `{id, weight}` entry), or (b) relied on `classCount` being absent (it is on by default for any test whose `layerSettings` does not switch it off), or (c) assert the placeholder coefficient (`model.test.js` "placeholder layer only adds objective terms..." expects 55 = stable 5 + placeholder 50; `stable` still exists in this task and the placeholder weight is now 2560, so in THIS task update that expectation to 2565 and add `classCount` and `graduatingSpread` to the test's off-list; Task 4 rewrites the test again once `stable` is gone).
Migration rule: keep each test's intent. Where a test wants one fairness layer on at a weight, replace the `layerSettings: [...]` with `...only("<layerId>", <level>)` (level 1-5; the weight is `4^(level-1)`, so old weight 2 becomes level 2, 5 becomes level 3, 100 becomes level 5). Where a test only wanted the soft layers quiet, `QUIET` now already includes `OFF("classCount")`. Add `OFF("classCount")` wherever a test builds its own `layerSettings` list that omits it. Do not change any assertion's meaning; list every migrated test in your report.
Re-run until `npm test` is green.

- [ ] **Step 5: Commit** — propose `feat(layers): add class-count fairness layer and take fairness weights from one setting`; wait for approval.

---

### Task 4: Retire `balance` and `stable`

**Files:**

- Delete: `src/layers/balance.js`, `src/layers/stable.js`, `tests/unit/layers/balance.test.js`
- Modify: `src/layers/registry.js`, `sample/sample.json`, `tests/unit/model.test.js` (lines 152-222), `src/solve.js` (comment line 9), `src/model.js` (comment line 68), `tests/unit/layers/rulesFixture.js` (drop the two `OFF` entries), the other layer tests that name `OFF("balance")`/`OFF("stable")`
- Test: `tests/unit/retired-layers.test.js` (create)

**Interfaces:** `balance` and `stable` are no longer registered; a saved `layerSettings` that still mentions them is harmlessly ignored. `sample.json` has a `classCount` entry and no `balance`/`stable`.

- [ ] **Step 1: Write the failing test** — `tests/unit/retired-layers.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/retired-layers.test.js`
Expected: FAIL (`balance` is still registered).

- [ ] **Step 3: Implement.**
  - Delete `src/layers/balance.js`, `src/layers/stable.js` and `tests/unit/layers/balance.test.js` with `git rm`.
  - `src/layers/registry.js`: remove the two imports and the two entries (`balanceLayer,` and `stableLayer,`).
  - `sample/sample.json`: delete the `balance` and `stable` entries from `layerSettings` and add `{ "id": "classCount", "enabled": true, "weight": 1 }` after the `mix`/`preps` entries.
  - `tests/unit/model.test.js`: delete the test "stable layer rewards keeping current assignments and penalises new ones" (lines 152-163). Replace the "placeholder layer only adds objective terms when a placeholder teacher exists" test (165-200) and the "a custom weight override changes the objective coefficient" test (214-222) with:

```js
test("placeholder layer only adds objective terms when a placeholder teacher exists", () => {
  const data = fixture();
  // Isolate from the soft fairness layers (each adds its own objective terms).
  data.layerSettings = ["classCount", "mix", "preps", "graduatingSpread"].map(
    (id) => ({
      id,
      enabled: false,
      weight: 0,
    }),
  );
  const withoutPlaceholder = buildModel(data);
  assert.equal(withoutPlaceholder.objectiveTerms.length, 0); // nothing else is soft here

  data.teachers.push({
    id: "t4",
    name: "New Teacher",
    roleId: "role1",
    capOverride: 10,
    qualifications: ["chem"],
    isPlaceholder: true,
  });
  const withPlaceholder = buildModel(data);
  const t4Var = withPlaceholder.varNameByPair.get("t4|g1");
  // Placeholder avoidance is 10x the largest fairness weight (256) = 2560.
  const t4Term = withPlaceholder.objectiveTerms.find(
    (t) => t.varName === t4Var,
  );
  assert.equal(t4Term && t4Term.coef, 2560);
});

test("fairness layer weights come from the Fairness emphasis, not from layerSettings", () => {
  const data = fixture();
  data.settings = {
    fairness: {
      preset: "custom",
      levels: { classCount: 1, mix: 1, preps: 1, graduating: 1 },
    },
  };
  data.layerSettings = [{ id: "classCount", enabled: true, weight: 999 }];
  const model = buildModel(data);
  const dev = model.objectiveTerms.find((t) => t.varName.startsWith("cc_dev_"));
  assert.ok(dev, "expected a classCount deviation term");
  assert.equal(dev.coef, 1); // level 1 -> weight 1, the saved 999 is ignored
});
```

- `src/solve.js` line 9 and `src/model.js` line 68: reword the comments that mention `stable.js` (solve.js: the "minimise changes" layer no longer exists, so "a re-solve is reproducible" now rests on the fixed random seed and locks; model.js: use `placeholder.js` and `classCount.js` as the example of two layers touching one variable's coefficient).
- Remove the `OFF("balance"), OFF("stable")` entries from `QUIET` and `only()` in `rulesFixture.js` and from any layer test's own list.
- `tests/unit/excel.test.js:144` and `tests/unit/versions.test.js:52` only use those ids as plain data in `layerSettings`; leave them.

- [ ] **Step 4: Run the full unit suite**

Run: `node --test tests/unit/retired-layers.test.js tests/unit/model.test.js` then `npm test`
Expected: PASS. If a Playwright test or `tests/unit/solve.test.js` asserted stable-driven behaviour (keeping an existing assignment on a re-solve), it was testing the retired layer: replace it with a lock-based equivalent (a locked assignment persists) rather than deleting the intent.

- [ ] **Step 5: Commit** — propose `refactor(layers): retire balance and stable`; wait for approval.

---

### Task 5: `fairnessReport`

**Files:**

- Modify: `src/fairness.js`
- Test: `tests/unit/fairness-report.test.js` (create)

**Interfaces:**

- Consumes: `bigThreshold`, `prepKey`, `graduatingSettings` from `src/data.js`; `idealClassCounts` (Task 2).
- Produces: `fairnessReport(data) -> { key:"classCount"|"mix"|"preps"|"graduating", text:string }[]` (empty when there are no assignments; placeholder teachers are ignored).

- [ ] **Step 1: Write the failing test** — `tests/unit/fairness-report.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fairnessReport } from "../../src/fairness.js";

const roles = [{ id: "r", name: "R", maxPeriods: null }];
const teacher = (id, name, over = {}) => ({
  id,
  name,
  roleId: "r",
  capOverride: 100,
  qualifications: ["A"],
  ...over,
});
const group = (id, level, periods = 6, over = {}) => ({
  id,
  level,
  block: "A",
  label: id,
  periods,
  teachersNeeded: 1,
  subjectId: "A",
  stream: "G2",
  ...over,
});
const asg = (teacherId, groupId) => ({ teacherId, groupId, locked: false });
const text = (report, key) => report.find((r) => r.key === key)?.text;

test("no assignments means no report, and bad input never throws", () => {
  assert.deepEqual(
    fairnessReport({
      roles,
      teachers: [teacher("a", "Amy")],
      groups: [group("g1", 3)],
      assignments: [],
    }),
    [],
  );
  assert.deepEqual(fairnessReport({}), []);
  assert.deepEqual(fairnessReport(null), []);
});

test("class count: names the largest gap from ideal", () => {
  const d = {
    roles,
    teachers: [teacher("a", "Amy"), teacher("b", "Ben")],
    groups: [1, 2, 3, 4].map((i) => group(`g${i}`, 3)),
    assignments: [
      asg("a", "g1"),
      asg("a", "g2"),
      asg("a", "g3"),
      asg("b", "g4"),
    ],
  };
  const t = text(fairnessReport(d), "classCount");
  assert.match(t, /Class count/);
  assert.match(t, /Amy/);
  assert.match(t, /\+1/); // 3 classes vs an ideal of 2
});

test("class count: perfectly even says everyone is on their ideal", () => {
  const d = {
    roles,
    teachers: [teacher("a", "Amy"), teacher("b", "Ben")],
    groups: [1, 2].map((i) => group(`g${i}`, 3)),
    assignments: [asg("a", "g1"), asg("b", "g2")],
  };
  assert.match(
    text(fairnessReport(d), "classCount"),
    /everyone is on their ideal/,
  );
});

test("mix: counts teachers more than 1 away from an even big/small split", () => {
  const d = {
    roles,
    teachers: [teacher("a", "Amy"), teacher("b", "Ben")],
    groups: [
      group("big1", 3, 10),
      group("big2", 3, 10),
      group("big3", 3, 10),
      group("s1", 3, 6),
    ],
    assignments: [
      asg("a", "big1"),
      asg("a", "big2"),
      asg("a", "big3"),
      asg("b", "s1"),
    ],
  };
  const t = text(fairnessReport(d), "mix");
  assert.match(t, /1 teacher/);
  assert.match(t, /Amy/);
  const even = {
    ...d,
    groups: [group("big1", 3, 10), group("s1", 3, 6)],
    assignments: [asg("a", "big1"), asg("a", "s1")],
  };
  assert.match(text(fairnessReport(even), "mix"), /every teacher/i);
});

test("preps: the most any teacher holds, by subject, stream and level", () => {
  const d = {
    roles,
    teachers: [teacher("a", "Amy")],
    groups: [group("g3", 3), group("g4", 4), group("g3b", 3)],
    assignments: [asg("a", "g3"), asg("a", "g4"), asg("a", "g3b")],
  };
  const t = text(fairnessReport(d), "preps");
  assert.match(t, /2/);
  assert.match(t, /Amy/);
});

test("graduating: names anyone above the preferred 2", () => {
  const d = {
    roles,
    teachers: [teacher("a", "Amy"), teacher("b", "Ben")],
    groups: [1, 2, 3].map((i) => group(`g${i}`, 4)).concat([group("g9", 4)]),
    assignments: [
      asg("a", "g1"),
      asg("a", "g2"),
      asg("a", "g3"),
      asg("b", "g9"),
    ],
  };
  assert.match(text(fairnessReport(d), "graduating"), /Amy/);
  const calm = { ...d, assignments: [asg("a", "g1"), asg("b", "g2")] };
  assert.match(text(fairnessReport(calm), "graduating"), /nobody is above 2/i);
});

test("placeholder-only assignments and a team-taught group do not crash and are not blamed on a placeholder", () => {
  const d = {
    roles,
    teachers: [
      teacher("a", "Amy"),
      teacher("p", "New Teacher", { isPlaceholder: true }),
    ],
    groups: [group("g1", 3, 6, { teachersNeeded: 2 })],
    assignments: [asg("a", "g1"), asg("p", "g1")],
  };
  const report = fairnessReport(d);
  for (const r of report) assert.equal(r.text.includes("New Teacher"), false);
  const onlyP = { ...d, assignments: [asg("p", "g1")] };
  assert.doesNotThrow(() => fairnessReport(onlyP));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/unit/fairness-report.test.js`
Expected: FAIL (`fairnessReport` is not exported).

- [ ] **Step 3: Implement** — add to `src/fairness.js` (extend the `data.js` import with `bigThreshold, prepKey, graduatingSettings`) and export `fairnessReport`:

```js
/** @param {number} n */
const signed = (n) => `${n > 0 ? "+" : ""}${Math.round(n * 10) / 10}`;

/**
 * Plain-language lines about how fair the current assignments are, one per
 * measure. Empty when nothing is assigned. Placeholder teachers are ignored.
 * @param {any} data
 * @returns {{key:"classCount"|"mix"|"preps"|"graduating", text:string}[]}
 */
function fairnessReport(data) {
  const teachers = (Array.isArray(data?.teachers) ? data.teachers : []).filter(
    (t) => t && !t.isPlaceholder,
  );
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
  if (assignments.length === 0 || teachers.length === 0) return [];

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const held = new Map(teachers.map((t) => [t.id, []]));
  for (const a of assignments) {
    const g = groupById.get(a?.groupId);
    if (g && held.has(a.teacherId)) held.get(a.teacherId).push(g);
  }
  if ([...held.values()].every((gs) => gs.length === 0)) return [];

  const out = [];
  const byId = new Map(teachers.map((t) => [t.id, t]));

  // Class count: the largest gap from each teacher's ideal.
  const ideals = idealClassCounts(data);
  let worst = null;
  for (const [id, ideal] of ideals) {
    const gap = (held.get(id)?.length ?? 0) - ideal;
    if (!worst || Math.abs(gap) > Math.abs(worst.gap)) worst = { id, gap };
  }
  if (worst) {
    out.push({
      key: "classCount",
      text:
        Math.abs(worst.gap) < 0.5
          ? "Class count: everyone is on their ideal number of classes."
          : `Class count: everyone is within ${Math.ceil(Math.abs(worst.gap))} class(es) of their ideal; the largest gap is ${byId.get(worst.id).name} at ${signed(worst.gap)}.`,
    });
  }

  // Mix: more than 1 away from an even big/small split.
  const threshold = bigThreshold(data);
  const off = [];
  for (const t of teachers) {
    const gs = held.get(t.id) || [];
    const big = gs.filter((g) => g.periods >= threshold).length;
    const diff = Math.abs(big - (gs.length - big));
    if (diff > 1) off.push({ name: t.name, big, small: gs.length - big, diff });
  }
  off.sort((a, b) => b.diff - a.diff);
  out.push({
    key: "mix",
    text:
      off.length === 0
        ? "Mix: every teacher is within 1 of an even big/small split."
        : `Mix: ${off.length} teacher(s) are more than 1 away from an even big/small split, most of all ${off[0].name} (${off[0].big} big, ${off[0].small} small).`,
  });

  // Preps: the most any teacher holds.
  let top = null;
  for (const t of teachers) {
    const n = new Set((held.get(t.id) || []).map(prepKey)).size;
    if (!top || n > top.n) top = { n, name: t.name };
  }
  if (top && top.n > 0) {
    out.push({
      key: "preps",
      text: `Preps: the most any teacher holds is ${top.n} (${top.name}).`,
    });
  }

  // Graduating: anyone above the preferred number.
  const { levels, prefer } = graduatingSettings(data);
  const over = [];
  for (const t of teachers) {
    const n = (held.get(t.id) || []).filter((g) =>
      levels.includes(g.level),
    ).length;
    if (n > prefer) over.push({ name: t.name, n });
  }
  over.sort((a, b) => b.n - a.n);
  out.push({
    key: "graduating",
    text:
      over.length === 0
        ? `Graduating: nobody is above ${prefer}.`
        : `Graduating: ${over.length} teacher(s) are above ${prefer}, most of all ${over[0].name} with ${over[0].n}.`,
  });
  return out;
}
```

and change the export line to `export { FAIRNESS_KEY_BY_LAYER, fairnessWeights, idealClassCounts, fairnessReport };`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/unit/fairness-report.test.js tests/unit/fairness.test.js`
Expected: PASS.

- [ ] **Step 5: Commit** — propose `feat(fairness): add the plain-language fairness report`; wait for approval.

---

### Task 6: Teachers tab — Target classes and Fill to cap

**Files:**

- Modify: `index.html` (Roles table header ~lines 836-840; Teachers table header ~lines 851-872), `src/ui/teachers.js` (`COUNT_FIELDS` line 9, `renderRoles` 17-35, `renderTeacherTable` 37-73, `wireRoles` 148-166, add-teacher object ~176-186)
- Test: `tests/e2e/fairness.spec.js` (create)

**Interfaces:**

- Consumes: `roleFillsToCap` (Task 1).
- Produces: Roles table column "Fill to cap" (checkbox `data-field="fillToCap"`), Teachers table column "Target classes" (`data-field="targetClasses"`, blank = automatic).

- [ ] **Step 1: Write the failing e2e test** — create `tests/e2e/fairness.spec.js`. First copy the helpers `signInAsHod`, `readStoredData`, `writeStoredData`, `loadSample` from `tests/e2e/board.spec.js` (lines 3-53; each spec file is self-contained, do not import across files). Then:

```js
test.describe("Fairness - Teachers tab", () => {
  test("HOD and SH/ST roles default to fill-to-cap, and the box saves", async ({
    page,
  }) => {
    await loadSample(page);
    await page.click('nav.tabs button[data-tab="teachers"]');
    const hod = page.locator(
      '#table-roles tbody tr[data-id="hod"] [data-field="fillToCap"]',
    );
    const teacher = page.locator(
      '#table-roles tbody tr[data-id="teacher"] [data-field="fillToCap"]',
    );
    await expect(hod).toBeChecked();
    await expect(
      page.locator(
        '#table-roles tbody tr[data-id="sh_st"] [data-field="fillToCap"]',
      ),
    ).toBeChecked();
    await expect(teacher).not.toBeChecked();
    await hod.uncheck();
    await teacher.check();
    const data = await readStoredData(page);
    expect(data.roles.find((r) => r.id === "hod").fillToCap).toBe(false);
    expect(data.roles.find((r) => r.id === "teacher").fillToCap).toBe(true);
  });

  test("a typed Target classes saves, and blank clears it", async ({
    page,
  }) => {
    await loadSample(page);
    await page.click('nav.tabs button[data-tab="teachers"]');
    const row = page.locator('#table-teachers tbody tr[data-id="t1"]');
    const box = row.locator('[data-field="targetClasses"]');
    await box.fill("4");
    expect(
      (await readStoredData(page)).teachers.find((t) => t.id === "t1")
        .targetClasses,
    ).toBe(4);
    await box.fill("");
    expect(
      (await readStoredData(page)).teachers.find((t) => t.id === "t1")
        .targetClasses,
    ).toBeNull();
  });
});
```

(with `import { test, expect } from "@playwright/test";` at the top.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx playwright test tests/e2e/fairness.spec.js`
Expected: FAIL (no `fillToCap` / `targetClasses` inputs).

- [ ] **Step 3: Implement.**

`index.html`: Roles `<thead>` add `<th title="Fill HOD, SH/ST and similar roles close to their own cap before sharing the rest by cap. Untick to share by cap like everyone else.">Fill to cap</th>` after the Max periods header; Teachers `<thead>` add after the "Max groups" `<th>`:

```html
<th
  title="The number of classes you would like this teacher to hold. Leave blank to let the solver work it out from caps and roles."
>
  Target classes
</th>
```

`src/ui/teachers.js`: import `roleFillsToCap` (`import { roleFillsToCap } from "../data.js";`); change `COUNT_FIELDS` to `["bigCount", "smallCount", "maxGroups", "targetClasses"]`; render each count cell with a per-field placeholder (`const PLACEHOLDER = { targetClasses: "auto" };` and `placeholder="${PLACEHOLDER[f] ?? "any"}"`); empty-table row `colspan="9"`; `renderRoles` adds a cell after the maxPeriods cell:

```js
      <td style="text-align:center"><input data-field="fillToCap" type="checkbox" ${roleFillsToCap(r) ? "checked" : ""} /></td>
```

`wireRoles` input handler: before the `maxPeriods` branch add `if (field === "fillToCap") return { ...r, fillToCap: e.target.checked };`; the add-teacher object gains `targetClasses: null,`.

- [ ] **Step 4: Run to verify it passes, then the existing Teachers e2e**

Run: `npx playwright test tests/e2e/fairness.spec.js tests/e2e/deployment.spec.js`
Expected: PASS. If an existing test counts table columns or cells, update the count (the only intended change).

- [ ] **Step 5: Commit** — propose `feat(ui): add Target classes and Fill to cap to the Teachers tab`; wait for approval.

---

### Task 7: Fairness emphasis card, Layers tab and the Solve report

**Files:**

- Create: `src/ui/fairness.js`
- Modify: `index.html` (`#panel-layers` ~line 994; CSS), `src/ui.js` (imports; `renderLayers` weight box; `onSolve` success; `renderAll`; the `if (!wired)` block)
- Test: `tests/e2e/fairness.spec.js` (append)

**Interfaces:**

- Consumes: `fairnessSettings`, `FAIRNESS_PRESETS` (Task 1); `FAIRNESS_KEY_BY_LAYER`, `fairnessReport` (Tasks 2, 5).
- Produces: static markup `#fairness` in the Solve tab; `renderFairness()` and `wireFairness()` from `src/ui/fairness.js`.

- [ ] **Step 1: Append failing e2e tests** to `tests/e2e/fairness.spec.js`:

```js
test.describe("Fairness - Solve tab", () => {
  const openSolve = async (page) => {
    await page.click('nav.tabs button[data-tab="layers"]');
    await expect(page.locator("#fairness")).toBeVisible();
  };

  test("a preset button saves the preset and marks it selected", async ({
    page,
  }) => {
    await loadSample(page);
    await openSolve(page);
    await expect(
      page.locator('#fairness [data-preset="classCountFirst"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await page.click('#fairness [data-preset="balanced"]');
    await expect(
      page.locator('#fairness [data-preset="balanced"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('#fairness [data-role="fairness-status"]'),
    ).toContainText("Balanced");
    const f = (await readStoredData(page)).settings.fairness;
    expect(f.preset).toBe("balanced");
  });

  test("moving a slider switches to Custom and saves the levels", async ({
    page,
  }) => {
    await loadSample(page);
    await openSolve(page);
    await page.locator('#fairness [data-key="preps"]').fill("5");
    const f = (await readStoredData(page)).settings.fairness;
    expect(f.preset).toBe("custom");
    expect(f.levels.preps).toBe(5);
    await expect(
      page.locator('#fairness [data-role="fairness-status"]'),
    ).toContainText("Custom");
  });

  test("the Layers list shows no weight box for the fairness layers", async ({
    page,
  }) => {
    await loadSample(page);
    await openSolve(page);
    for (const id of ["classCount", "mix", "preps", "graduatingSpread"]) {
      const card = page.locator(`#layers-list [data-layer-id="${id}"]`);
      await expect(card).toContainText("Fairness emphasis");
      await expect(card.locator(".weight-field")).toHaveCount(0);
    }
  });

  test("Solve reports what it gave up", async ({ page }) => {
    await loadSample(page);
    await openSolve(page);
    await page.click("#btn-solve");
    await expect(page.locator("#solve-status")).toContainText("Solved", {
      timeout: 60000,
    });
    await expect(page.locator("#solve-status")).toContainText("Class count:");
    await expect(page.locator("#solve-status")).toContainText("Preps:");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test tests/e2e/fairness.spec.js -g "Solve tab"`
Expected: FAIL (`#fairness` not found).

- [ ] **Step 3: Implement.**

`index.html`: in `#panel-layers`, before `<div id="layers-list"></div>`, add the static card (so a slider being dragged is never re-rendered away):

```html
<section id="fairness" class="fairness-card">
  <h2>Fairness emphasis</h2>
  <p class="muted">
    How much each kind of fairness matters when Solve has to trade one against
    another. Higher steps are stronger; one step usually wins a trade-off and
    two steps almost always do.
  </p>
  <div class="toolbar" role="group" aria-label="Fairness presets">
    <button
      data-action="fairness-preset"
      data-preset="classCountFirst"
      aria-pressed="false"
    >
      Class count first
    </button>
    <button
      data-action="fairness-preset"
      data-preset="balanced"
      aria-pressed="false"
    >
      Balanced
    </button>
    <button
      data-action="fairness-preset"
      data-preset="fewerPreps"
      aria-pressed="false"
    >
      Fewer preps
    </button>
  </div>
  <div data-role="fairness-status" role="status" aria-live="polite"></div>
  <details>
    <summary>Advanced: set each priority yourself</summary>
    <label class="fairness-row"
      >Even class counts
      <input
        type="range"
        min="1"
        max="5"
        step="1"
        data-action="fairness-level"
        data-key="classCount" />
      <span data-role="level-classCount"></span
    ></label>
    <label class="fairness-row"
      >Even big/small mix
      <input
        type="range"
        min="1"
        max="5"
        step="1"
        data-action="fairness-level"
        data-key="mix" />
      <span data-role="level-mix"></span
    ></label>
    <label class="fairness-row"
      >Fewer preps
      <input
        type="range"
        min="1"
        max="5"
        step="1"
        data-action="fairness-level"
        data-key="preps" />
      <span data-role="level-preps"></span
    ></label>
    <label class="fairness-row"
      >Spread graduating classes
      <input
        type="range"
        min="1"
        max="5"
        step="1"
        data-action="fairness-level"
        data-key="graduating" />
      <span data-role="level-graduating"></span
    ></label>
    <p class="muted">1 = barely matters, 5 = matters most.</p>
  </details>
</section>
```

plus CSS (next to `.intake-card`): `.fairness-card { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin: 10px 0; } .fairness-row { display: flex; gap: 8px; align-items: center; margin: 6px 0; } .fairness-card button[aria-pressed="true"] { font-weight: 600; outline: 2px solid var(--accent, #2a6df4); }`.

`src/ui/fairness.js`:

```js
// Fairness emphasis card (Solve tab): preset buttons and four 1-5 sliders. The
// markup is static in index.html, so this only sets values and listens; a
// slider mid-drag is never replaced by a re-render. Slider changes use the
// `change` event (fires on release), presets use click.

import { getData, setData } from "./store.js";
import { FAIRNESS_PRESETS, fairnessSettings } from "../data.js";

const LABELS = {
  classCountFirst: "Class count first",
  balanced: "Balanced",
  fewerPreps: "Fewer preps",
  custom: "Custom",
};

function renderFairness() {
  const root = document.getElementById("fairness");
  if (!root) return;
  const { preset, levels } = fairnessSettings(getData());
  for (const b of root.querySelectorAll('[data-action="fairness-preset"]')) {
    b.setAttribute(
      "aria-pressed",
      b.dataset.preset === preset ? "true" : "false",
    );
  }
  for (const input of root.querySelectorAll('[data-action="fairness-level"]')) {
    input.value = String(levels[input.dataset.key]);
    const out = root.querySelector(`[data-role="level-${input.dataset.key}"]`);
    if (out) out.textContent = `step ${levels[input.dataset.key]} of 5`;
  }
  const status = root.querySelector('[data-role="fairness-status"]');
  if (status && !status.dataset.touched)
    status.textContent = `Current emphasis: ${LABELS[preset]}.`;
}

function save(root, preset, levels, message) {
  const data = getData();
  setData({
    ...data,
    settings: { ...(data.settings || {}), fairness: { preset, levels } },
  });
  const status = root.querySelector('[data-role="fairness-status"]');
  if (status) {
    status.dataset.touched = "1";
    status.textContent = message;
  }
}

function wireFairness() {
  const root = document.getElementById("fairness");
  if (!root) return;
  root.addEventListener("click", (e) => {
    const b = e.target.closest('[data-action="fairness-preset"]');
    if (!b || !FAIRNESS_PRESETS[b.dataset.preset]) return;
    save(
      root,
      b.dataset.preset,
      { ...FAIRNESS_PRESETS[b.dataset.preset] },
      `Fairness emphasis set to ${LABELS[b.dataset.preset]}. It applies the next time you press Solve.`,
    );
  });
  root.addEventListener("change", (e) => {
    const input = e.target.closest('[data-action="fairness-level"]');
    if (!input) return;
    const { levels } = fairnessSettings(getData());
    const next = { ...levels, [input.dataset.key]: Number(input.value) };
    save(
      root,
      "custom",
      next,
      "Fairness emphasis set to Custom. It applies the next time you press Solve.",
    );
  });
}

export { renderFairness, wireFairness };
```

`src/ui.js`: import `{ renderFairness, wireFairness } from "./ui/fairness.js"`, `{ FAIRNESS_KEY_BY_LAYER, fairnessReport } from "./fairness.js"`; call `wireFairness()` after `wireLayers()` in the `if (!wired)` block and `renderFairness()` in `renderAll()`; in `renderLayers`, replace the soft-layer weight block with:

```js
          ${
            layer.kind === "soft" && FAIRNESS_KEY_BY_LAYER[layer.id]
              ? `<p class="muted">Weight set by Fairness emphasis (above).</p>`
              : layer.kind === "soft"
                ? `
            <div class="weight-field">
              <label>Weight</label>
              <input type="number" min="0" step="0.5" data-action="weight-layer" value="${esc(weight)}" />
            </div>`
                : ""
          }
```

and in `onSolve`, replace the success `setStatus(...)` with a version that appends the report (build the new data once so the report reads the NEW assignments):

```js
const solved = {
  ...working,
  assignments: result.assignments.map((a) => ({
    ...a,
    locked: wasLocked(working, a),
  })),
};
recordUndoPoint(); // so the Board's Undo can reverse this solve
await setData(solved);
const lines = fairnessReport(solved)
  .map((r) => `<li>${esc(r.text)}</li>`)
  .join("");
setStatus(
  `Solved. ${result.assignments.length} assignment(s) made.${lines ? `<ul>${lines}</ul>` : ""}`,
  "ok",
);
```

(remove the now-duplicated original `recordUndoPoint(); await setData({...})` block; keep the await-the-write comment.)

- [ ] **Step 4: Run to verify they pass, then the whole e2e suite**

Run: `npx playwright test tests/e2e/fairness.spec.js` then `npx playwright test` and `npm test`
Expected: PASS. If an existing e2e test asserted the exact text "Solved. N assignment(s) made." with `toHaveText`, loosen it to `toContainText` (the report is appended).

- [ ] **Step 5: Commit** — propose `feat(ui): add the Fairness emphasis card and the post-Solve report`; wait for approval.

---

### Task 8: Docs and final verification

**Files:**

- Modify: `CLAUDE.md` (Key files table; layer-template pointer at line ~50), `docs/superpowers/specs/2026-10-05-fairness-solver-design.md`

- [ ] **Step 1: Update the spec** — append a "Planning amendments" section with the three items at the top of this plan (placeholder avoidance outranks the fairness weights = 10 x the largest; test helper `only()` and migrated tests; weight resolution always from `settings.fairness`/default for the four layers and `placeholder`). Also add to "Retired" that the Solve-tab report is appended to the existing "Solved." status.

- [ ] **Step 2: Update project `CLAUDE.md`** — add a Key files row for `src/fairness.js` (pure: fairness weights, ideal class counts, post-Solve report; used by `src/model.js`, `src/layers/classCount.js` and the Solve tab); change the "best templates" sentence in "How to add a new constraint layer" so it no longer names the retired `src/layers/stable.js` (use `src/layers/graduatingSpread.js` for a simple soft layer); add one line under step 4 or 5: "Soft layers that are part of the fairness emphasis (`classCount`, `mix`, `preps`, `graduatingSpread`) take their weight from `src/fairness.js`, not from `layerSettings`; add the layer id to `FAIRNESS_KEY_BY_LAYER` if you add another one." Write only these additions.

- [ ] **Step 3: Full verification** (evidence before any claim of success)

Run: `npm test`, then `npm run test:rules`, then `npx playwright test`.
Expected: all PASS. Paste the summary lines of all three into the report.

- [ ] **Step 4: Hands-on check on the sample school** — `npm run emulators` and `npm run serve`; on the Solve tab try each preset and a slider, press Solve and read the report; on the Teachers tab tick/untick Fill to cap and type a Target classes; confirm the Layers tab shows no weight boxes for the four fairness layers. Report what you saw. (A headless implementer cannot do this: leave it to the user and say so.)

- [ ] **Step 5: Commit** — propose `docs: document the fairness solver`; wait for approval. Do not push.

---

## Self-Review

**Spec coverage:** four measures on one scale and weights `4^(level-1)` (Tasks 2, 3); ideals typed > fill-to-cap > cap share (Task 2); `classCount` layer (Task 3); presets + sliders + storage + default (Tasks 1, 7); retire `balance`/`stable` with ignored saved settings (Task 4); new fields and Excel (Tasks 1, 6); Layers tab shows no weight boxes (Task 7); "what this solve gave up" report on Solve (Tasks 5, 7); old-file safety (Tasks 1, 4); docs (Task 8). Placeholder interaction found while planning: amendment 1, Task 2 weights and the Task 3 test.

**Placeholder scan:** no TBD/TODO. Two "find and migrate" instructions (Task 3 Step 4, Task 7 Step 4) name the cause, the rule and the only permitted change.

**Type consistency:** `fairnessSettings`/`FAIRNESS_PRESETS`/`roleFillsToCap` (Task 1) are used with the same signatures in Tasks 2, 6, 7; `fairnessWeights`, `idealClassCounts`, `FAIRNESS_KEY_BY_LAYER` (Task 2) in Tasks 3, 5, 7; `fairnessReport` (Task 5) in Task 7; levels keys are `classCount, mix, preps, graduating` everywhere, and the layer id for the fourth is `graduatingSpread` mapped through `FAIRNESS_KEY_BY_LAYER`.

**Review Focus coverage:** (1) Task 4 test 2; (2) Task 2 degenerate test and Task 3 target-0/unreachable test; (3) Task 3 placeholder test; (4) Task 5 tests; (5) Task 1 old-roles-sheet test.
