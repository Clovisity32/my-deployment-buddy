# Workbench board — design (piece 1 of 4)

Date: 2026-10-03

## Problem

The HOD finds the app slower than Excel or paper for building a deployment:

- Groups are generated from the Classes, Bands and Subjects tabs, so restructuring means going back through those tabs.
- Custom groups are appended after generated ones (`src/setup.js:228`), so a new G2 group appears away from its siblings.
- Group names are inconsistent (`src/setup.js:142,178,196`).
- There are no live per-teacher counts while editing.
- Moving, swapping or cancelling assignments is fiddly.

## Scope

This is piece 1 of 4. Each piece has its own spec, plan and build.

1. **Workbench board** (this spec).
2. Solver fixes and plain-language priorities (the "Yiting stuck at 5" problem: `stable` weight 5 anchors re-solves, `balance` is % of cap, nothing balances class count).
3. Ranked options explorer.
4. Insights buddy.

Out of scope here: any change to the solver, layers or weights, except making the big/small threshold configurable.

## Agreed decisions

- Layout: subject cards plus a live teacher tally.
- The board is the master list of groups; setup is only a starting point.
- Big/small stays based on periods, with a configurable threshold.
- Names are auto-built, e.g. `S3 Phy G2 (3E1+3E2)`.
- Drag-and-drop is included.

## Constraints (from project CLAUDE.md)

- No build step; every `src/` file stays a native ES module.
- No real data in the repo; Firestore sync and the overwrite guard are unchanged.
- Re-opening a saved file or version never re-solves.
- Old files without the new fields must load unchanged.

## Design

### 1. Data model: the board owns groups

- `data.groupsFrozen: boolean`.
  - First Workbench open: `groups = generateGroups(data)` once, set `groupsFrozen = true`. Group ids are kept, so existing assignments survive.
  - While frozen, edits in Classes, Bands and Subjects no longer call `rebuildGroups`.
  - A "Rebuild groups from setup" button in the Classes and Bands tabs calls `rebuildGroups` (`src/setup.js:356`) after a confirm dialog that states how many groups and assignments will be replaced.
- Group fields: `tag` (`""|"G1"|"G2"|"G3"`); `classIds` already exists.
- `groupLabel(data, group)` in new pure module `src/board.js`:
  - `S{level} {subjectShort} {classes}`, e.g. `S3 Phy 3E1`.
  - With a tag or more than one class: `S{level} {subjectShort} {tag} ({c1+c2})`.
  - `label` is derived, not typed.
- `data.settings.bigPeriods` (default 10). `bigThreshold(data)` in `src/data.js` replaces the `BIG_PERIODS` constant in `src/layers/mix.js`, `src/layers/groupCount.js`, `src/view.js` and `src/diagnose.js`.
- `validate()`, the JSDoc typedefs, `sample/sample.json` and Excel export/import (`src/excel.js`) gain `tag`, `groupsFrozen` and `settings.bigPeriods`.

### 2. Pure board logic (`src/board.js`)

- `buildBoard(data, arrange)` with `arrange` as `"subject"` or `"level"`. It returns cards of `{level, subjectId, title, rows}`. Rows are sorted by tag, then natural class order. Each row has periods, `isBig`, teachers, locked and warnings.
- Pure edit operations (`data → data`): `addGroup(level, subjectId)`, `deleteGroup`, `duplicateGroup`, `splitGroup`, `combineGroups(ids, tag)`, `setTag`, `assign`, `clearSeat`, `moveSeat`, `swapSeats`, `toggleLock`.
  - `deleteGroup` also drops that group's assignments.
  - `splitGroup` gives one group per class.
- `buildTally(data)` extends `buildTeacherView` (`src/view.js:178`) with % of cap, class count, a status string, and a totals row (total demand vs Σcap, unfilled seats).
- `rowWarnings` and `teacherWarnings` reuse `wouldExceedCap` and `teacherLoad` (`src/view.js:241,260`), the qualification and band-clash logic, and `preCheck` pieces from `src/diagnose.js:25` where they fit.

### 3. Board UI (`src/ui/board.js`, new tab in `index.html`)

- A "Board" tab replaces ⑤ Groups and the ⑦ Sheet layout. The By-teacher view is absorbed into the tally. Old renderers are removed once the board passes its tests.
- Cards sit in a responsive grid with an "Arrange by: Subject | Level" toggle. Subject puts all Physics levels side by side; Level puts Sec 1 LSS next to Sec 2 LSS.
- Each row shows the name, periods, a BIG/sm badge, teacher chip(s) with a picker, a 🔒 lock, and a ⋯ menu (clear, duplicate, split, combine with…, delete).
  - The picker lists qualified teachers first, each as "Name 12/18 · 0B 3S".
- Each card has "+ add group" with level and subject prefilled.
- Drag-and-drop uses native HTML5, no library.
  - Chip onto a row: move if the seat is empty, swap if filled.
  - Chip onto a teacher in the tally: reassign the class to that teacher.
  - Chip onto the "Unassigned" tray: clear the seat.
  - An unqualified drop is refused with a plain-language toast.
  - The picker and ⋯ menu remain the keyboard and fallback path.
- The tally is sticky beside the board on wide screens and below it on narrow ones. Clicking a teacher highlights their rows.
- Undo/redo is an in-memory stack of data snapshots (Ctrl+Z / Ctrl+Y plus buttons). All edits go through `src/ui/store.js` as today.
- Every action gives visible feedback (toast or highlight), and warnings show inline.
- The existing Solve button, with its existing behaviour, is also placed on the board.

### Files

- New: `src/board.js`, `src/ui/board.js`, `tests/unit/board.test.js`, `tests/e2e/board.spec.*`.
- Modified: `index.html`, `src/ui.js`, `src/data.js`, `src/setup.js`, `src/view.js`, `src/excel.js`, `src/layers/mix.js`, `src/layers/groupCount.js`, `src/diagnose.js`, `src/ui/classes.js`, `src/ui/bands.js`, `sample/sample.json`.
- Removed after parity: `src/ui/groups.js` and the sheet-layout part of `src/ui/deployment.js`.

## Planning amendments (found while writing the implementation plan)

1. **The spec's `tag` is the existing `group.stream`** (G1/G2/G3/PURE). No new field is added; changing it also updates `category`. `setTag` becomes `updateGroup(..., {stream})`.
2. **`groupLabel(group)`** takes only the group (it never needed `data`).
3. **`manualLabel`** (new optional boolean on a group) keeps a name the HOD typed (e.g. the existing custom group "Enrichment: Chem Research Club") from being overwritten by the auto-name. Clearing the typed name goes back to the auto-name. Identical auto-names get " #1", " #2" so no two rows look alike.
4. **A group details editor** (name, periods, teachers needed, stream, classes, note) is added to each row's ⋯ menu. Without it the Board could not replace the old Groups tab, which edited teachers-needed and notes.
5. **Going over a teacher's cap is allowed on the Board and shown as a warning**, instead of being refused as the old sheet did. A swap passes through states that exceed a cap, and the HOD wants to see the result. Unqualified, locked, already-on-this-group and no-free-seat are still refused with a plain-language message. Solve still enforces the cap.
6. **A quick-add control** (level + subject + "Add group") sits in the Board toolbar so a brand-new level/subject can be started even on an empty Board, in addition to the per-card "+ add group".

## Error handling

- Every pure operation is fail-safe and never throws; invalid input returns the data unchanged plus a reason for the toast.
- Deleting a group that has assignments, and "Rebuild groups from setup", ask for confirmation.

## Testing

- Unit (`tests/unit/board.test.js`, run via `npm test`):
  - label building
  - sort order, so a new G2 row sits next to its siblings
  - split, combine and delete keep assignments consistent
  - tally totals
  - `bigThreshold` is used by mix and groupCount
  - an old file without the new fields loads identically and never re-solves
- E2E (Playwright, build first if the config targets the prod server):
  - add a group into a block and check its position
  - drag a chip to swap and check the tally updates
  - undo restores the swap
  - an unqualified drop is refused
  - "Rebuild groups from setup" asks for confirmation
- Manual: arrange-by toggle, sticky tally and narrow-width layout on the sample school via `npm run serve`.
