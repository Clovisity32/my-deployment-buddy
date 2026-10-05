# Data and rule layers — design (piece 1 of the post-Board roadmap)

Date: 2026-10-04

## Problem

The HOD builds a deployment in rounds: pre-fill known placements, solve the rest, review, add restrictions, re-solve. Today the app cannot express the rules that drive those placements:

- Teachers following their classes from last year (continuity).
- Form teachers teaching their own class.
- Teachers who should not take certain levels or streams.
- A limit on graduating classes per teacher.
- Preps counted by subject, level and stream (`src/layers/preps.js:22` ignores level).

The same facts also have to be entered without retyping them, from the Excel sheets the HOD already keeps.

## Scope

In scope: new data fields, an Excel template/upload/paste intake, an "Apply continuity" action, three new solver layers (`deny`, `formTeacher`, `graduating`), and the prep-by-level change.

Out of scope (later pieces): fairness weighting of class count, big/small and `stable`/`balance` retuning; the insights panel and guided questions; the export table; the checkpoint tree and compare; setter/marker duties and SOW owners.

## Agreed decisions (from the requirements grilling, 2026-10-04)

- Continuity is hard-locked by default for **Sec 1→2 and Sec 3→4 only** (not Sec 4→5). The HOD unlocks exceptions with the Board's existing lock toggle.
- Continuity is applied as **ordinary locked assignments**, not as a solver rule.
- A form teacher must teach at least one science group that contains their form class.
- The deny list is per teacher, a hard rule, and easy to relax by deleting the rule.
- Graduating = Sec 4 (G1/G2/G3) and Sec 5. Hard limit 3 per teacher; 2 preferred.
- Prep = subject + level + stream.
- A team-taught group counts as 1 class for each teacher, with a visible marker on the Board.
- Last year's teachers come from last year's app data or an Excel upload. Each input has a downloadable template and an upload.
- Matching of names is rule-based and offline. No AI.

## Constraints (from project CLAUDE.md)

- No build step; native ES modules only. The Excel code already uses SheetJS (`XLSX`), so no new dependency.
- No real data in the repo; templates carry fictional examples only.
- Re-opening a file or version never re-solves. Old files without the new fields load unchanged.
- Layers follow the registry recipe: one file in `src/layers/`, registered in `src/layers/registry.js`, a default in `sample/sample.json`, `HARD_PREFIXES` and `explainConstraint()` in `src/diagnose.js` for hard layers, unit tests, and typedefs plus `validate()` in `src/data.js`.

## Design

### 1. Data model (all optional)

- `class.formTeacherId: string|null`.
- `teacher.denies: {level?:number, stream?:string, subjectId?:string}[]`. A missing part means "any".
- `data.lastYear: {level:number, classSuffix:string, subjectId:string, teacherId:string}[]`. Stored data only; nothing but "Apply continuity" reads it.
- `data.settings.graduatingLevels` (default `[4, 5]`), `maxGraduating` (default 3), `preferGraduating` (default 2). Accessors in `src/data.js` follow `bigThreshold`: anything that is not a sensible value falls back to the default.
- `validate()`, the JSDoc typedefs, `sample/sample.json` (fictional examples) and `src/excel.js` export/import gain these fields. Versions snapshot assignments only and are unaffected.

### 2. Solver layers

- **`deny` (hard).** Same pattern as `src/layers/qualification.js`: `filterPairs()` drops any (teacher, group) pair matching one of the teacher's rules before variables exist. No constraints; the model stays small.
- **`formTeacher` (hard).** For each class with a `formTeacherId`: `Σ x(formTeacher, g) ≥ 1` over science groups whose `classIds` include that class. Constraint names `formTeacher_<classId>`.
- **`graduating` (hard + soft).** Hard: per teacher, Σ x over groups in `graduatingLevels` ≤ `maxGraduating`. Soft: a slack variable per teacher for groups above `preferGraduating`, costing `weight` per group (same mechanism as `src/layers/groupCount.js`). Team-taught groups count once per teacher. Constraint names `graduating_<teacherId>`.
- **`preps` change.** The prep key becomes `subjectId + level + stream` (the `subjectOf` helper at `src/layers/preps.js:22`). Weight unchanged at 0.5; piece 2 retunes priorities.
- `diagnose.js`: `formTeacher` and `graduating` join `HARD_PREFIXES` (`deny` is structural, so it surfaces through the coverage pre-check like qualification), plus plain-language `explainConstraint()` cases, e.g. "Mdm Tan is form teacher of 3E1 but isn't qualified for any science group that class has".

### 3. Intake and continuity

New pure module `src/intake.js` (unit-testable without a browser):

- `templateFor(kind)` → rows for a downloadable sheet. Kinds and columns:
  - `formTeachers`: `Class | Form teacher`
  - `lastYear`: `Level | Class | Subject | Teacher`
  - `denies`: `Teacher | Level | Stream | Subject` (blank = any)
    Each has a header row and one fictional example row.
- `parseIntake(kind, rows, data)` → `{ ok, unmatched, next }`. Names match case-insensitively with titles (Mdm, Mr, Ms…) ignored. No match or an ambiguous match goes into `unmatched` with a plain-language reason. Never throws.
- Pasted text and uploaded files both become rows first, so they share one code path.
- `applyContinuity(data)` → `{ data, added, skipped }`. It builds locked assignments for Sec 1→2 and Sec 3→4 from `lastYear` (3E1 → 4E1: level + 1, same suffix). It skips, with a reason, a teacher no longer qualified, a group that does not exist, or a seat that is already locked. It never re-creates a seat the HOD unlocked on purpose.

UI: a new Intake panel in Setup (`src/ui/intake.js`, wired in `src/ui.js`). Per kind: Download template, Upload file, Paste box, a preview table of matched rows and unmatched rows to fix, and Save. "Apply continuity" is a Board-toolbar button that confirms with counts first. The Board marks team-taught groups with a small symbol. Every action gives visible feedback, and errors say what to do next.

## Error handling

- Pure functions are fail-safe. Invalid input returns the data unchanged plus a reason for the UI.
- Unmatched intake rows are never silently dropped or guessed; they are listed for the HOD to fix before saving.
- Hard layers that can be individually infeasible explain themselves through `diagnose.js`.

## Testing

- Unit: name matching (titles, duplicates, typos); template round-trip; `applyContinuity` mapping and each skip reason; each new layer on the real HiGHS solver with the existing 3-teacher/4-group fixture; `diagnose` plain-language messages; preps counted by level; an old file without the new fields loads identically and never re-solves.
- E2E (Playwright): download a template, upload a filled one, fix an unmatched row, apply continuity, see locked chips on the Board.
- Parity: none needed (no ported logic).

## Remaining questions for later pieces

- Exact column layouts of the HOD's own sheets may differ from these templates; the paste/upload preview is the safety net.
- Whether "forced minimums" (e.g. "X must take at least 5 classes") belongs in the insights panel (piece 3).

## Planning amendments

Decided while reading the code during planning:

1. **Graduating is two layers**, `graduatingMax` (hard, prefix `graduatingMax_`) and `graduatingSpread` (soft, prefix `graduatingSpread_`). The Layers tab gives a weight box only to soft layers and `diagnose.js` relaxes anything under a hard prefix, so a mixed layer would misbehave in both.
2. **`lastYear` rows use `classRef`**, not `classSuffix`: the class cell as typed (e.g. `301` or `Curiosity`), resolved when continuity is applied (by id, else by unique class name), because last year's classes no longer exist in `data.classes`.
3. **Template files** have a `Template` sheet (headers plus the current rows) and an `Example` sheet. Upload and paste replace that kind's whole list, and Save stays disabled while any row has a problem. Save re-parses the previewed rows against the current data (added in a Task 10 fix).
4. **Intake cards live at the bottom of the Teachers tab** (static HTML, so a half-typed paste is not wiped by `renderAll`), not in a new tab.
5. **Graduating settings** (`graduatingLevels`, `maxGraduating`, `preferGraduating`) are editable in the Excel Settings sheet only; there is no UI for them in this piece.
6. **A denied seat placed by hand on the Board shows a warning** instead of being refused (same stance as going over a cap). Solve will not keep it.
