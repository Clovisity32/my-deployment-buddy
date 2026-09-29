# Firestore sync for shared deployment editing

## Context

Today, a deployment (teachers, subjects, classes, bands, groups, assignments,
versions) lives entirely in one browser's `localStorage`. The only way to
move it between devices or hand it to someone else is `Save to Excel` /
`Open from Excel…`. The HOD wants their co-HOD to be able to open the site
and continue adjusting the same live deployment, without manually passing
files back and forth.

## Requirements (confirmed with the user)

- **Who:** the HOD and one co-HOD/colleague. Not a wider team.
- **Freshness:** "latest-on-open" is enough — whoever opens the app gets the
  most recent saved state. True simultaneous live sync (seeing each other
  type) is explicitly NOT required.
- **Access control:** Google Sign-In, restricted server-side (Firestore
  security rules) to exactly two allowed email addresses.
- **Offline:** explicitly NOT required to be preserved. The user chose
  "require internet now" over keeping a local offline-capable copy — a
  deliberate, informed trade of the project's current offline guarantee for
  simplicity. This is a real change to two of this project's CLAUDE.md
  non-negotiables (see below).
- **Data-loss protection:** since two people can edit across the same day
  without reloading in between, a warn-before-overwrite guard is required
  (not full live conflict resolution — just "don't silently clobber").
- **Scalability of versions:** `Save version` snapshots accumulate over
  years of use; embedding them all in one Firestore document risks hitting
  Firestore's 1MB per-document limit. Versions are split into their own
  subcollection so the main document stays small indefinitely.

## Non-Goals

- Real-time collaborative editing (seeing the other person's cursor/edits
  live). Latest-on-open is sufficient per the user.
- Supporting more than two named users. No general user-management UI, no
  self-service "invite a teammate" flow — the allowlist is edited directly
  in Firestore security rules by whoever has console access.
- Preserving offline capability. The app requires internet after this
  change; this is accepted, not an oversight.
- Migrating existing localStorage data automatically into Firestore. The
  user can re-load their sample/real data (or re-import from a
  previously-exported Excel file) into the new Firestore-backed app; a
  one-time export-then-import round trip covers this without needing new
  migration code.

## Architecture

### Data model (Firestore)

- `deployments/main` — a single document holding everything the current
  localStorage blob holds **except** `versions`:
  `roles, subjects, classes, bands, teachers, groups, groupOverrides,
customGroups, assignments, layerSettings`, plus two new fields:
  - `updatedAt`: Firestore server timestamp, set on every write.
  - `updatedBy`: the email of whoever last wrote it.
- `deployments/main/versions/{versionId}` — one document per saved version,
  same shape saveVersion() already produces (`name, timestamp, assignments,
layerSettings`), just as its own collection instead of an array field
  that only grows.

There is exactly one deployment document (`main`) — this project has one
school, one HOD, one co-HOD. No per-user or per-school namespacing is
needed; if that ever changes it's a separate, later decision.

### Auth & access control

- Firebase Auth, Google provider. A small sign-in screen is shown before
  the app's tabs render; the app does not attempt to read/write Firestore
  until a user is signed in.
- Firestore security rules restrict all reads/writes under `deployments/main`
  (document and `versions` subcollection) to a hardcoded two-email
  allowlist (`request.auth.token.email in ['hod@...', 'coHod@...']`).
  Expanding access means editing the security rules, not the app.
- Firebase config values (`apiKey`, `projectId`, etc.) are committed to the
  repo/embedded in the client — they are public identifiers, not secrets;
  the security rules are what actually protect the data. (No real student/
  teacher data or credentials are ever committed — see CLAUDE.md.)

### Code changes

- **`src/ui/store.js`** — internals swap from `localStorage.getItem/setItem`
  to Firestore `getDoc`/`setDoc` (via a transaction for the overwrite
  guard, see below). `getData()`/`setData()`/`onChange()` keep their exact
  current signatures — every tab module (`subjects.js`, `classes.js`,
  `bands.js`, `teachers.js`, `groups.js`, `deployment.js`) is unaffected,
  since they only ever call this same API. `setData()` becomes
  fundamentally async under the hood (a network write); the store's public
  functions may need to become promise-returning or fire-and-forget with a
  visible save-status indicator — this is an implementation-plan-level
  detail, not a design-level one, but flagged here since every call site
  assumes today's synchronous `setData()`.
- **`src/versions.js`** — `saveVersion`/`listVersions`/`restoreVersion`
  currently operate on a plain `data.versions` array; they become thin
  wrappers around Firestore's `versions` subcollection (`addDoc`,
  `getDocs`, read-one-then-merge-into-`assignments`/`layerSettings`).
- **New `src/auth.js`** — wraps Firebase Auth: sign-in, sign-out, "current
  user" state, and the allowlist-rejection UI path (a rules-denied write
  surfaces here as a clear "you're not authorized" message, not a raw
  Firestore error).
- **`index.html`** — adds the Firebase SDK via `<script type="module">`
  pointed at the Google-hosted CDN ESM build (no bundler needed, consistent
  with how XLSX/HiGHS are already vendored), plus a sign-in screen shown
  before `nav.tabs`.
- **`src/data.js`** — `loadFromStorage`/`saveToStorage`/`STORAGE_KEY` are
  removed (no longer meaningful once Firestore is the source of truth).
  `emptyData()`, `validate()`, `migrateV1()`, `effectiveCap()` are
  unaffected — they don't know or care where `data` comes from.
- **Excel import/export** (`src/excel.js`) is unchanged and kept — useful
  as a backup/portability format, and as the only path that still works if
  the school's internet is down (an explicit trade-off the user accepted:
  the live app now requires internet, but Excel remains a manual fallback).

### Conflict / overwrite guard

- On load: fetch `deployments/main`, remember its `updatedAt`.
- On save: run a Firestore transaction that re-reads `updatedAt` and
  compares it to the value remembered at load time.
  - If unchanged: write goes through, `updatedAt`/`updatedBy` are updated.
  - If changed (the other person saved since this session loaded): the
    write is aborted and the UI shows "`<updatedBy>` updated this since you
    opened it — reload to see their changes before continuing," blocking
    further edits until the page is reloaded. This is deliberately a hard
    stop, not a merge — with two people and "latest-on-open" semantics, a
    silent field-level merge is not needed and would add real complexity
    for a case that should be rare in practice.

### Testing

- Unit tests (`node --test`) don't exercise `store.js` today (they test
  `data.js`/`setup.js`/`view.js`/the layers/`model`/`solve`/`diagnose`/
  `excel` directly, all pure functions) — unaffected by this change.
- `tests/unit/data.test.js`'s `loadFromStorage`/`saveToStorage` test cases
  are removed along with the functions they test.
- E2E tests (Playwright, `tests/e2e/deployment.spec.js`) currently exercise
  the real UI including `store.js`'s persistence layer end-to-end. These
  are pointed at the **Firebase Local Emulator Suite** (Firestore + Auth
  emulators, run locally, no real network or the two real Google accounts
  involved) so the suite stays fast, deterministic, and doesn't depend on
  internet access or consume real quota/accounts. `playwright.config.js`'s
  `webServer` step is extended to also start the emulator suite alongside
  the static file server.

## What stays exactly the same

- The HiGHS solver (`src/solve.js`, `src/model.js`) — fully client-side,
  untouched.
- Every tab's rendering/wiring logic (`src/ui/subjects.js`, `classes.js`,
  `bands.js`, `teachers.js`, `groups.js`, `deployment.js`) — unchanged,
  since they only ever call `store.js`'s `getData`/`setData`.
- Excel import/export, as a secondary/backup path.

## CLAUDE.md updates required

Two current non-negotiables in this project's `CLAUDE.md` are being
deliberately superseded by this change, with the user's explicit sign-off:

- _"The solver runs entirely offline"_ → gains a clarifying note: the HiGHS
  solve itself is still fully client-side/offline, but the app as a whole
  now requires internet connectivity to load/save deployment data via
  Firestore.
- _"Real deployment data lives in the HOD's browser (localStorage) and the
  Excel file they carry"_ → replaced: real deployment data lives in
  Firestore, shared between the HOD and co-HOD via Google Sign-In
  (restricted to their two accounts by security rules); Excel
  export/import remains as a portability/backup format, not the primary
  store.
- New line: access is restricted to a hardcoded two-email allowlist
  enforced in Firestore security rules — expanding access means editing
  those rules, not app code.

This CLAUDE.md edit is part of the implementation plan for this spec, not
a separate task.

## Open items for the implementation plan (not decided here)

- Exact shape of the async `setData()` call sites across all tab modules
  (promise-returning vs. fire-and-forget-with-status-indicator) — a
  plan-level/code-level decision, not a design-level one.
- Exact save-status UI (e.g. a small "Saving…" / "Saved" / "Sign-in
  required" / "Someone else updated this" indicator) and where it lives in
  the layout.
- Firebase project creation and security-rules text are user-driven setup
  steps done alongside implementation, not pre-written here since they
  depend on the actual project/email values the user will supply.
