# My Deployment Buddy

A browser-only MILP solver that assigns Science teachers to teaching groups
for a Singapore secondary school (Full Subject-Based Banding). Built for a
Head of Department who edits and solves **at school** (browser only, no
installs) while all _development_ happens **at home** via Claude Code.

Read `docs/superpowers/specs/` (if present) or ask the user for
`~/.claude/plans/i-am-the-head-mossy-hippo.md` for the original design
rationale.

## Non-negotiables

- **No build step.** Every file under `src/` is loaded directly as an ES
  module (`<script type="module">` in the browser, native `import` under
  `node --test`). Don't introduce a bundler/transpiler without discussing it
  first — the whole point is a static site the school laptop can just open.
- **No real student/teacher data in the repo.** The repo and the hosted page
  only ever contain code and the fictional `sample/` school. Real deployment
  data lives in Firestore, shared between the HOD and their co-HOD via
  Google Sign-In; access is restricted to a hardcoded two-email allowlist
  enforced in `firestore.rules` (expanding access means editing that file
  and re-pasting it into the Firebase console - never app code). Excel
  export/import remains as a portability/backup format, not the primary
  store. Check `.gitignore` before adding any file that might contain real
  names.
- **Re-opening never re-solves.** Loading a saved Excel file or restoring a
  version must reproduce the exact same assignments — never trigger a fresh
  solve. Only the "Solve" button solves.
- **The HiGHS solve itself runs entirely offline.** HiGHS WASM is vendored
  in `src/vendor/highs/` (copied from `node_modules/highs/build/`, not
  imported live) so solving never needs a network call. The app as a
  whole, however, now requires internet connectivity to load/save the
  deployment (see Firestore sync below) - this is a deliberate trade
  made when shared editing was added; it is not an oversight.

## How to add a new constraint layer

This is the one recurring task in this project. A layer is a single file in
`src/layers/` that plugs into `src/layers/registry.js` — nothing else
changes.

1. Copy the shape of an existing layer close to what you're adding:
   `src/layers/loadCap.js` (a simple hard per-teacher constraint) or
   `src/layers/stable.js` (a simple soft objective-only layer) are the best
   templates.
2. Implement the contract (see the comment block at the top of
   `src/layers/registry.js`):
   ```js
   const myLayer = {
     id: "myLayer", // stable id - becomes the constraint-name prefix
     name: "Human label",
     kind: "hard" | "soft",
     defaultWeight: 0, // only matters for 'soft'
     describe(data) {
       return "One sentence, shown in the Layers tab.";
     },
     build(ctx) {
       /* ctx.addConstraint(...) and/or ctx.addObjectiveTerm(...) */
     },
     // filterPairs(data, pairs) — OPTIONAL, only if the layer removes some
     // (teacher, group) pairs entirely before any variable is created
     // (qualification.js is the only current example — read it first if you
     // think you need this).
   };
   export { myLayer };
   ```
3. Register it in `src/layers/registry.js`: import it and add it to the
   `LAYERS` array. Order only affects the readability of the generated LP.
4. Add a default entry to `layerSettings` in `sample/sample.json` so the
   Layers tab has something sensible to show (`{ id, enabled: true, weight }`).
5. **Constraint names must stay ASCII-identifier-safe conceptually** (letters/
   digits/underscore) even though `model.js` sanitizes them for you when
   writing the LP text — keep the `<layerId>_<entityId>` convention so
   `src/diagnose.js`'s `HARD_PREFIXES` list and `explainConstraint()` can map
   a violated constraint back to a plain-language sentence. If your layer is
   hard and can be individually infeasible, add its prefix to
   `HARD_PREFIXES` in `diagnose.js` and a case to `explainConstraint()`.
6. Write unit tests in `tests/unit/model.test.js` (or a new
   `tests/unit/layers/<id>.test.js` if the logic is nontrivial) using the
   existing 3-teacher/4-group fixture pattern — add teachers/groups to it
   only if your layer needs a shape the fixture doesn't already cover.
7. Run `npm test`. If your layer can make the model infeasible, add a case to
   `tests/unit/diagnose.test.js` confirming the pre-check or elastic re-solve
   explains it in plain language.
8. If the layer needs new fields on Teacher/Group/Assignment, add them to the
   JSDoc typedefs and `validate()` in `src/data.js`, and to
   `sample/sample.json`.

## Key files

| File                     | Responsibility                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/data.js`            | Schema and `validate()`. All fail-safe (never throws). Persistence lives in `src/ui/store.js` (Firestore-backed).                                       |
| `src/layers/registry.js` | Ordered list of layers + the contract they implement.                                                                                                   |
| `src/layers/*.js`        | One constraint/objective concern each.                                                                                                                  |
| `src/model.js`           | Pure: `data` + enabled layers → CPLEX-LP text. Unit-testable without a browser.                                                                         |
| `src/solve.js`           | Loads vendored HiGHS WASM, solves, parses assignments. Deterministic.                                                                                   |
| `src/diagnose.js`        | Pre-checks + elastic re-solve → plain-language infeasibility messages.                                                                                  |
| `src/auth.js`            | Google Sign-In wrapper (Firebase Auth). Gates app boot.                                                                                                 |
| `src/ui/store.js`        | Single source of truth for in-memory `data`, backed by Firestore (`deployments/main`), with an optimistic-local + transactional overwrite guard.        |
| `src/versions.js`        | Saved-version snapshots, stored in the `deployments/main/versions` Firestore subcollection.                                                             |
| `sample/sample.json`     | Fictional school mirroring the real sheet's structure (bands, co-teaching, a placeholder teacher) — used by tests and as the demo/reset data in the UI. |
| `firestore.rules`        | Security rules restricting all access to the two-email allowlist.                                                                                       |

## Testing

- `npm test` — `node --test tests/unit/*.test.js`. Fast; several tests run
  the real HiGHS solver (no mocking) because it's fast enough and mocking it
  would hide real LP-generation bugs (two were caught this way already: a
  duplicate-variable objective term, and dashes in ids breaking the LP
  parser — see the regression tests in `tests/unit/solve.test.js`).
- `npm run e2e` — Playwright, needs `npm run serve` (or Playwright's own
  webServer config) pointed at `index.html`.

## Deployment

GitHub Pages, but **ask the user before** creating the repo or enabling
Pages — see the approved plan for why (privacy: confirm the fictional
sample is all that's committed, first).
