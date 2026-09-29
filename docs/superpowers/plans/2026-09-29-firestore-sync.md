# Firestore Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the HOD and one co-HOD open My Deployment Buddy from any device, sign in with Google, and see/edit the same live deployment, replacing the current localStorage-only, single-browser data model.

**Architecture:** Firestore stores the deployment as one document (`deployments/main`, everything except `versions`) plus a `versions` subcollection (one doc per saved snapshot, so the main document never grows unbounded). `src/ui/store.js` keeps its exact current `getData()`/`setData()`/`onChange()` public API — every tab UI module (`subjects.js`, `classes.js`, `bands.js`, `teachers.js`, `groups.js`, `deployment.js`) needs zero changes — only the store's internals swap from `localStorage` to Firestore, with an optimistic local cache (instant UI updates) backed by an async write with a transaction-based overwrite guard. Google Sign-In (Firebase Auth) gates the app; Firestore security rules restrict access to a two-email allowlist.

**Tech Stack:** Firebase JS SDK v10 (modular, loaded via `https://www.gstatic.com/firebasejs/` ESM CDN URLs directly in `import` statements - no bundler, matching this project's no-build-step constraint), Firebase Local Emulator Suite (Firestore + Auth) for testing, `@firebase/rules-unit-testing` for security-rules tests, `firebase-tools` as a devDependency (test/dev tooling only, does not affect the shipped static site).

**Spec:** `docs/superpowers/specs/2026-09-29-firestore-sync-design.md`

## Global Constraints

- No build step for the shipped site: every `src/` file stays a native ES module loadable via `<script type="module">` and (where applicable) `node --test`. Firebase is loaded via direct CDN `import` URLs, never `npm install`ed into the shipped bundle.
- No real student/teacher data in the repo (`sample/sample.json` stays fictional). Real Firebase config values (API key, project ID) ARE committed - they are public client identifiers, not secrets; security rules are what protects the data.
- The app now requires internet connectivity to load/save deployment data (this project's prior "solver runs entirely offline" guarantee is deliberately narrowed to "the HiGHS solve itself is offline" - see spec).
- Access is restricted to exactly two Google account emails, enforced server-side in `firestore.rules` - never trust a client-side check alone.
- Every value interpolated into `innerHTML` (including attributes) goes through `esc()` from `src/ui/dom.js`, per this project's existing convention.
- `npm test` (unit) must stay fast and mock-free where the codebase already tests real solves; new Firestore-dependent tests use the real Local Emulator Suite, never a hand-rolled Firestore mock.

## Review Focus

- A save that races another save (both HOD and co-HOD editing near-simultaneously) must never silently drop one person's change - the overwrite guard's transaction must be exercised with a real concurrent write in a test, not just asserted about in isolation.
- Signing in with a Google account NOT on the two-email allowlist must be cleanly rejected (clear message, no partial data leak) - tested against the real Firestore emulator rules, not just described in `firestore.rules`.
- Reloading the page after a successful solve must still never trigger a re-solve, now that data loads from Firestore instead of localStorage - this project's core non-negotiable, re-verified under the new backend.
- Restoring a saved version must work with the new subcollection-backed `versions.js` API exactly as it did with the old array-based one (same assignments/layerSettings end up applied) - a version saved before this change has no equivalent (out of scope per spec), but a version saved and restored entirely within the new system must round-trip exactly.
- A network/Firestore error while loading (e.g., emulator or Firestore is unreachable) must show the HOD a clear, actionable message instead of a blank page or a raw stack trace in the console.

---

## File Structure

- **Create** `firebase.json` - emulator ports/config.
- **Create** `.firebaserc` - default project id (`demo-my-deployment-buddy`, the special `demo-` prefix that lets emulators run with no real GCP project).
- **Create** `firestore.rules` - the two-email allowlist security rules.
- **Create** `src/firebase-config.js` - Firebase project config values + an `?emulators=1` query-param switch, so the same static file (no build step) can point at either real Firebase or the local emulators.
- **Create** `src/auth.js` - Firebase Auth wrapper: Google sign-in/out, current-user state.
- **Modify** `src/ui/store.js` - swap localStorage for Firestore, add the overwrite guard and save-status API.
- **Modify** `src/versions.js` - swap the embedded `data.versions` array for the `deployments/main/versions` subcollection.
- **Modify** `index.html` - add a sign-in screen, a save-status indicator, wrap the existing app markup in a hideable `#app-shell`.
- **Modify** `src/ui.js` - auth-gated boot sequence; async-aware Versions tab wiring; `onSolve()` updated for the new `saveVersion()` signature.
- **Modify** `src/data.js` - remove `loadFromStorage`/`saveToStorage`/`STORAGE_KEY` (no longer meaningful; Firestore is now the source of truth).
- **Modify** `playwright.config.js` - add the emulator suite as a second `webServer`.
- **Modify** `tests/e2e/deployment.spec.js` - sign in via the Auth emulator before each flow; add the conflict-guard and unauthorized-email tests from Review Focus.
- **Modify** `CLAUDE.md` - the two superseded non-negotiables + the new allowlist line, per the spec.
- **Create** `tests/rules/firestore-rules.test.js` - security-rules tests via `@firebase/rules-unit-testing`.
- **Modify** `tests/unit/data.test.js` - remove the now-deleted `loadFromStorage`/`saveToStorage` test cases.
- **Modify** `package.json` - new devDependencies (`firebase`, `firebase-tools`, `@firebase/rules-unit-testing`) and scripts (`emulators`, `test:rules`).

---

### Task 1: Emulator scaffolding

**Files:**

- Create: `firebase.json`
- Create: `.firebaserc`
- Modify: `package.json`

**Interfaces:**

- Consumes: nothing (first task).
- Produces: a running local Firestore emulator on `127.0.0.1:8081` and Auth emulator on `127.0.0.1:9099`, reachable via `npm run emulators`; `firebase emulators:exec '<cmd>'` for one-shot test runs. Every later task that talks to Firestore/Auth uses these exact ports.

- [ ] **Step 1: Install the tooling**

```bash
npm install --save-dev firebase firebase-tools @firebase/rules-unit-testing
npm view firebase version
```

Note the printed version (e.g. `10.14.1`) - Tasks 3, 4, and 5 hardcode this exact version in their `gstatic.com` CDN import URLs. If it differs from `10.14.1` used below, use the actual installed version consistently in every CDN URL in this plan.

- [ ] **Step 2: Create `firebase.json`**

```json
{
  "firestore": {
    "rules": "firestore.rules"
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8081 },
    "ui": { "enabled": true, "port": 4000 }
  }
}
```

(Firestore's emulator default port, 8080, is left free deliberately - this project's own static file server already uses 8080 via `npm run serve`, and both run together during e2e tests.)

- [ ] **Step 3: Create `.firebaserc`**

```json
{
  "projects": {
    "default": "demo-my-deployment-buddy"
  }
}
```

A project id prefixed `demo-` runs the emulators with no real Firebase project or credentials required - correct for local dev/test. Task 3 documents where to put the REAL project id for production.

- [ ] **Step 4: Add npm scripts**

In `package.json`, add to `"scripts"`:

```json
"emulators": "firebase emulators:start --project demo-my-deployment-buddy",
"test:rules": "firebase emulators:exec --project demo-my-deployment-buddy --only firestore,auth \"node --test tests/rules/*.test.js\""
```

- [ ] **Step 5: Verify the emulators boot**

Run: `npx firebase emulators:start --project demo-my-deployment-buddy &` then, after a few seconds, `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4000` then stop the emulator process.
Expected: `200` (the Emulator UI is up), confirming both emulators started without config errors. Stop the background process before continuing.

- [ ] **Step 6: Commit**

```bash
git add firebase.json .firebaserc package.json package-lock.json
git commit -m "chore: scaffold Firebase local emulator suite for Firestore sync"
```

---

### Task 2: Firestore security rules

**Files:**

- Create: `firestore.rules`
- Test: `tests/rules/firestore-rules.test.js`

**Interfaces:**

- Consumes: the emulator config from Task 1 (Firestore on port 8081).
- Produces: `firestore.rules`, deployed automatically to the emulator via `firebase.json`'s `firestore.rules` pointer (Task 1); the production Firebase project needs these rules pasted into its console manually (documented in a comment in the file itself - this project has no CI/CD pipeline to auto-deploy rules).

- [ ] **Step 1: Write the failing rules tests**

Create `tests/rules/firestore-rules.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, collection, addDoc } from "firebase/firestore";

const ALLOWED_EMAILS = ["hod@example.com", "cohod@example.com"];

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-my-deployment-buddy",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8081,
    },
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test("an allowed email can read and write deployments/main", async () => {
  const ctx = testEnv.authenticatedContext("hod-uid", {
    email: ALLOWED_EMAILS[0],
  });
  const db = ctx.firestore();
  await assertSucceeds(setDoc(doc(db, "deployments/main"), { roles: [] }));
  await assertSucceeds(getDoc(doc(db, "deployments/main")));
});

test("an allowed email can read and write a version in the versions subcollection", async () => {
  const ctx = testEnv.authenticatedContext("hod-uid", {
    email: ALLOWED_EMAILS[0],
  });
  const db = ctx.firestore();
  await assertSucceeds(
    addDoc(collection(db, "deployments/main/versions"), {
      name: "v1",
      timestamp: new Date().toISOString(),
      assignments: [],
      layerSettings: [],
    }),
  );
});

test("an email not on the allowlist is denied", async () => {
  const ctx = testEnv.authenticatedContext("stranger-uid", {
    email: "stranger@example.com",
  });
  const db = ctx.firestore();
  await assertFails(setDoc(doc(db, "deployments/main"), { roles: [] }));
  await assertFails(getDoc(doc(db, "deployments/main")));
});

test("an unauthenticated request is denied", async () => {
  const ctx = testEnv.unauthenticatedContext();
  const db = ctx.firestore();
  await assertFails(getDoc(doc(db, "deployments/main")));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:rules`
Expected: FAIL - `firestore.rules` does not exist yet, or (once an empty/default-deny file exists) the "allowed email" tests fail because nothing grants access.

- [ ] **Step 3: Write `firestore.rules`**

```
rules_version = '2';

// Access is restricted to exactly two Google account emails - the HOD and
// one co-HOD. Expanding access means editing this list and re-pasting these
// rules into the Firebase console (production has no auto-deploy for
// rules); it never means changing app code. See
// docs/superpowers/specs/2026-09-29-firestore-sync-design.md.
//
// PRODUCTION SETUP: replace the two emails below with your real Google
// account emails before pasting these rules into the Firebase console.
service cloud.firestore {
  match /databases/{database}/documents {
    function isAllowed() {
      return request.auth != null &&
        request.auth.token.email in [
          'hod@example.com',
          'cohod@example.com'
        ];
    }

    match /deployments/main {
      allow read, write: if isAllowed();

      match /versions/{versionId} {
        allow read, write: if isAllowed();
      }
    }
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test:rules`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/rules/firestore-rules.test.js
git commit -m "feat: add Firestore security rules restricting access to a two-email allowlist"
```

---

### Task 3: Google Sign-In (`src/auth.js`)

**Files:**

- Create: `src/firebase-config.js`
- Create: `src/auth.js`
- Test: `tests/e2e/auth.spec.js`

**Interfaces:**

- Consumes: nothing new (talks to the Auth emulator directly).
- Produces (for Tasks 4, 5, 7 to import):
  - `src/firebase-config.js`: `export { firebaseConfig, useEmulators }` - `firebaseConfig` is the plain config object; `useEmulators` is a boolean.
  - `src/auth.js`: `export { app, onAuthChange, getCurrentUser, signInWithGoogle, signOutUser }` where:
    - `app` - the initialized Firebase App instance (Task 4/5 call `getFirestore(app)` with it).
    - `onAuthChange(fn)` - registers `fn(user | null)`, called once immediately with the current state and again on every sign-in/out. `user` is `{email, uid}`.
    - `getCurrentUser()` - returns `{email, uid} | null` synchronously (the last value `onAuthChange` delivered).
    - `signInWithGoogle()` - `async`, throws on failure/popup-closed.
    - `signOutUser()` - `async`.

- [ ] **Step 1: Create `src/firebase-config.js`**

```js
// Firebase project config. These values are public client identifiers, not
// secrets - safe to commit. Access is protected by firestore.rules, not by
// hiding these. See
// docs/superpowers/specs/2026-09-29-firestore-sync-design.md "Auth & access
// control".
//
// PRODUCTION SETUP: replace with your real Firebase project's config
// (Firebase console -> Project settings -> General -> Your apps -> Web app).
const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_FIREBASE_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
};

// Opt into the local emulator suite via a query param, e.g.
// index.html?emulators=1 - no build step, no env vars, works identically
// whether the file is opened locally or served from GitHub Pages.
const useEmulators =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("emulators");

export { firebaseConfig, useEmulators };
```

- [ ] **Step 2: Create `src/auth.js`**

```js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseConfig, useEmulators } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
}

let currentUser = null;
const listeners = [];

onAuthStateChanged(auth, (user) => {
  currentUser = user ? { email: user.email, uid: user.uid } : null;
  listeners.forEach((fn) => fn(currentUser));
});

/** @param {(user: {email:string, uid:string} | null) => void} fn */
function onAuthChange(fn) {
  listeners.push(fn);
}

function getCurrentUser() {
  return currentUser;
}

async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

async function signOutUser() {
  await signOut(auth);
}

export { app, onAuthChange, getCurrentUser, signInWithGoogle, signOutUser };
```

- [ ] **Step 3: Write a failing e2e test for sign-in**

Create `tests/e2e/auth.spec.js`:

```js
import { test, expect } from "@playwright/test";

// The Auth emulator's REST API can pre-seed a user and hand back a custom
// token an app would normally get via a real Google popup - avoiding the
// need to drive an actual Google OAuth consent screen in CI. This project's
// pages don't have that helper wired up yet (that's what this test drives
// into existence): a tiny debug page at tests/e2e/fixtures/auth-harness.html
// that imports src/auth.js and exposes signInWithGoogle()/getCurrentUser()
// to Playwright via page.evaluate, using the emulator's documented
// "auto-accept" behavior for signInWithPopup when connectAuthEmulator is
// active (the emulator never shows a real Google screen; it immediately
// resolves with a deterministic fake account you select via the emulator UI
// or a pre-configured test account).
test("signing in with an allowed email exposes the user's email via getCurrentUser()", async ({
  page,
}) => {
  await page.goto("/tests/e2e/fixtures/auth-harness.html?emulators=1");
  await page.click("#trigger-sign-in");
  await expect(page.locator("#current-email")).toHaveText("hod@example.com", {
    timeout: 10000,
  });
});
```

- [ ] **Step 4: Create the harness fixture the test needs**

Create `tests/e2e/fixtures/auth-harness.html`:

```html
<!doctype html>
<html>
  <body>
    <button id="trigger-sign-in">Sign in</button>
    <span id="current-email"></span>
    <script type="module">
      import { onAuthChange, signInWithGoogle } from "../../../src/auth.js";

      onAuthChange((user) => {
        document.getElementById("current-email").textContent = user
          ? user.email
          : "";
      });
      document
        .getElementById("trigger-sign-in")
        .addEventListener("click", () => signInWithGoogle());
    </script>
  </body>
</html>
```

The Auth emulator intercepts `signInWithPopup` and, in headless/automated contexts, auto-resolves it against a deterministic test account rather than opening a real Google consent screen - Playwright drives the click, the emulator handles the rest with no external network call.

- [ ] **Step 5: Run it to verify it fails**

Run: `npm run emulators &` (wait ~5s), then `npx playwright test tests/e2e/auth.spec.js`
Expected: FAIL before `src/auth.js`/`src/firebase-config.js` exist (module not found), or the sign-in never resolves if those files aren't yet in place.

- [ ] **Step 6: Confirm it passes with the files from Steps 1-2 in place**

Run: `npx playwright test tests/e2e/auth.spec.js` (emulators still running from Step 5)
Expected: PASS - `#current-email` shows `hod@example.com`.

Stop the emulator process afterward.

- [ ] **Step 7: Commit**

```bash
git add src/firebase-config.js src/auth.js tests/e2e/auth.spec.js tests/e2e/fixtures/auth-harness.html
git commit -m "feat: add Google Sign-In via Firebase Auth"
```

---

### Task 4: Firestore-backed store with overwrite guard

**Files:**

- Modify: `src/ui/store.js` (full rewrite of the persistence internals; public shape changes - see Interfaces)
- Test: `tests/e2e/store.spec.js`
- Test: `tests/e2e/fixtures/store-harness.html`

**Interfaces:**

- Consumes: `app` and `getCurrentUser` from `src/auth.js` (Task 3); `useEmulators` from `src/firebase-config.js` (Task 3).
- Produces (Task 5, 7 import these; this REPLACES store.js's old `replaceData`/`isDirty`/`clearDirty` exports, which are removed - no other file used them outside `src/ui.js`, updated in Task 7):
  - `initStore()` - `async`, fetches `deployments/main` once, populates the in-memory cache. Must be called (and awaited) once, after sign-in, before rendering.
  - `getData()` - unchanged signature: returns the current in-memory data object.
  - `setData(next)` - unchanged call-site signature (fire-and-forget, no return value used by any caller): updates the cache and notifies `onChange` listeners synchronously, then writes to Firestore in the background.
  - `onChange(fn)` - unchanged.
  - `onSaveStatusChange(fn)` - new: `fn({status, message})` where `status` is one of `'saving' | 'saved' | 'conflict' | 'error' | 'blocked'`.
  - `isBlocked()` - new: `true` once a conflict has occurred; `setData()` becomes a no-op (plus a `'blocked'` status notification) until the page reloads.
  - `getFirestoreDb()` - new: returns the Firestore instance, for `versions.js` (Task 5) to build its own doc/collection references from the same connection.

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/store.spec.js`:

```js
import { test, expect } from "@playwright/test";

test("setData writes to Firestore and a second page load sees it", async ({
  page,
  context,
}) => {
  await page.goto("/index.html?emulators=1");
  await signInAsHod(page);
  await page.click('[data-tab="subjects"]');
  await page.click("#btn-add-subject");
  await page.fill(
    '#table-subjects tbody tr:last-child input[data-field="name"]',
    "Test Subject",
  );

  const page2 = await context.newPage();
  await page2.goto("/index.html?emulators=1");
  await signInAsHod(page2);
  await expect(
    page2.locator(
      '#table-subjects tbody tr:last-child input[data-field="name"]',
    ),
  ).toHaveValue("Test Subject", { timeout: 10000 });
});

test("a stale write is blocked with a plain-language conflict message", async ({
  context,
}) => {
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  await pageA.goto("/index.html?emulators=1");
  await pageB.goto("/index.html?emulators=1");
  await signInAsHod(pageA);
  await signInAsHod(pageB);

  // Both load the same starting state, then A saves first.
  await pageA.click('[data-tab="subjects"]');
  await pageA.click("#btn-add-subject");
  await expect(page.locator("#subjects-status")).not.toContainText("Saving");

  // B, still holding the pre-A state, now also writes.
  await pageB.click('[data-tab="subjects"]');
  await pageB.click("#btn-add-subject");

  await expect(pageB.locator("#save-status")).toContainText(
    "updated this since you opened it",
    { timeout: 10000 },
  );
});

async function signInAsHod(page) {
  await page.click("#sign-in-button");
  await expect(page.locator("#app-shell")).toBeVisible({ timeout: 10000 });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run emulators &` (wait ~5s), then `npx http-server -p 8080 -c-1 &`, then `npx playwright test tests/e2e/store.spec.js`
Expected: FAIL - `store.js` still reads/writes localStorage, `#save-status`/`#app-shell`/`#sign-in-button` don't exist yet (those land in Tasks 6-7).

(This test can only fully pass once Tasks 6 and 7 also land - that's expected for a data-layer task whose consumers aren't wired yet. Steps 3-4 below implement `store.js` itself and confirm its logic works via a narrower check; the full green run happens at the end of Task 7's completion, which this plan's final verification re-confirms.)

- [ ] **Step 3: Rewrite `src/ui/store.js`**

```js
// Single source of truth for the browser UI's in-memory `data`, backed by
// Firestore (deployments/main). Every tab module (src/ui/*.js) still only
// ever calls getData()/setData()/onChange() - only this file's internals
// know about Firestore. See
// docs/superpowers/specs/2026-09-29-firestore-sync-design.md "Conflict /
// overwrite guard" for why setData() is optimistic-local + transactional.

import {
  getFirestore,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { app, getCurrentUser } from "../auth.js";
import { useEmulators } from "../firebase-config.js";

const db = getFirestore(app);
if (useEmulators) {
  connectFirestoreEmulator(db, "127.0.0.1", 8081);
}

function mainDocRef() {
  return doc(db, "deployments", "main");
}

function emptyDeploymentDoc() {
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
  };
}

let data = null;
let loadedUpdatedAt = null;
let blocked = false;
const listeners = [];
const statusListeners = [];

function getData() {
  return data;
}

function onChange(fn) {
  listeners.push(fn);
}

function onSaveStatusChange(fn) {
  statusListeners.push(fn);
}

function isBlocked() {
  return blocked;
}

function getFirestoreDb() {
  return db;
}

function notifyStatus(status, message) {
  statusListeners.forEach((fn) => fn({ status, message }));
}

/** Fetches deployments/main once. Call after sign-in, before rendering. */
async function initStore() {
  const snap = await getDoc(mainDocRef());
  const fetched = snap.exists() ? snap.data() : emptyDeploymentDoc();
  loadedUpdatedAt = fetched.updatedAt || null;
  const { updatedAt, updatedBy, ...rest } = fetched;
  data = rest;
}

class ConflictError extends Error {
  constructor(updatedBy) {
    super("conflict");
    this.updatedBy = updatedBy;
  }
}

function stripMeta({ updatedAt, updatedBy, ...rest }) {
  return rest;
}

async function writeToFirestore(next) {
  const ref = mainDocRef();
  const user = getCurrentUser();
  notifyStatus("saving");
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const serverUpdatedAt = snap.exists() ? snap.data().updatedAt : null;
      const bothPresent = loadedUpdatedAt && serverUpdatedAt;
      const changed =
        bothPresent &&
        !(serverUpdatedAt.isEqual
          ? serverUpdatedAt.isEqual(loadedUpdatedAt)
          : serverUpdatedAt === loadedUpdatedAt);
      if (changed) {
        throw new ConflictError(snap.data().updatedBy);
      }
      tx.set(ref, {
        ...stripMeta(next),
        updatedAt: serverTimestamp(),
        updatedBy: user ? user.email : null,
      });
    });
    const snap = await getDoc(ref);
    loadedUpdatedAt = snap.data().updatedAt;
    notifyStatus("saved");
  } catch (err) {
    if (err instanceof ConflictError) {
      blocked = true;
      const snap = await getDoc(ref);
      const { updatedAt, updatedBy, ...rest } = snap.data();
      data = rest;
      listeners.forEach((fn) => fn());
      notifyStatus(
        "conflict",
        `${err.updatedBy || "Someone else"} updated this since you opened it - reload to see their changes before continuing.`,
      );
    } else {
      notifyStatus("error", err.message);
    }
  }
}

/**
 * Updates the in-memory cache and notifies listeners immediately (instant
 * UI feedback, same feel as the old localStorage-backed store), then writes
 * to Firestore in the background. A no-op once isBlocked() is true.
 */
function setData(next) {
  if (blocked) {
    notifyStatus("blocked", "Reload the page to continue.");
    return;
  }
  data = next;
  listeners.forEach((fn) => fn());
  writeToFirestore(next);
}

export {
  initStore,
  getData,
  setData,
  onChange,
  onSaveStatusChange,
  isBlocked,
  getFirestoreDb,
};
```

- [ ] **Step 4: Verify `store.js`'s core logic directly, without needing the full app UI**

`store.spec.js` (Steps 1-2) needs `#sign-in-button`/`#app-shell`, which don't exist until Tasks 6-7 - it stays red until then (expected, noted in Step 2). To get real, immediate RED→GREEN verification of `store.js` itself now, add a small standalone harness (same pattern as Task 3's `auth-harness.html`, which already works at this point in the plan).

Create `tests/e2e/fixtures/store-harness.html`:

```html
<!doctype html>
<html>
  <body>
    <button id="load">Load</button>
    <button id="save">Save</button>
    <pre id="data-out"></pre>
    <span id="status-out"></span>
    <script type="module">
      import { signInWithGoogle } from "../../../src/auth.js";
      import {
        initStore,
        getData,
        setData,
        onSaveStatusChange,
      } from "../../../src/ui/store.js";

      onSaveStatusChange(({ status, message }) => {
        document.getElementById("status-out").textContent = message
          ? `${status}: ${message}`
          : status;
      });

      document.getElementById("load").addEventListener("click", async () => {
        await signInWithGoogle();
        await initStore();
        document.getElementById("data-out").textContent =
          JSON.stringify(getData());
      });

      document.getElementById("save").addEventListener("click", () => {
        setData({
          ...getData(),
          roles: [{ id: "r1", name: "Test Role", maxPeriods: 10 }],
        });
      });
    </script>
  </body>
</html>
```

Add to `tests/e2e/store.spec.js`:

```js
test("initStore() loads the current doc and setData() writes it back with a 'saved' status", async ({
  page,
}) => {
  await page.goto("/tests/e2e/fixtures/store-harness.html?emulators=1");
  await page.click("#load");
  await expect(page.locator("#data-out")).not.toHaveText("", {
    timeout: 10000,
  });
  await page.click("#save");
  await expect(page.locator("#status-out")).toHaveText("saved", {
    timeout: 10000,
  });
});
```

Run: `npm run emulators &` (wait ~5s), then `npx http-server -p 8080 -c-1 &`, then `npx playwright test tests/e2e/store.spec.js -g "initStore"`
Expected: FAIL before `store.js` is rewritten (Step 3) - confirm this ran RED before Step 3's code existed by checking it fails now for the right reason (`initStore is not a function` or similar), then re-run after Step 3's rewrite.
Expected after Step 3: PASS. Stop both background processes afterward.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store.js tests/e2e/store.spec.js tests/e2e/fixtures/store-harness.html
git commit -m "feat: rewrite store.js to sync through Firestore with an overwrite guard"
```

---

### Task 5: Versions as a Firestore subcollection

**Files:**

- Modify: `src/versions.js` (signature changes - see Interfaces)
- Test: `tests/unit/versions.test.js` (existing file, needs a real Firestore connection now - moves to using the emulator, matching this project's "test the real thing" philosophy already used for the HiGHS solver)

**Interfaces:**

- Consumes: `getFirestoreDb()` from `src/ui/store.js` (Task 4).
- Produces (Task 7 imports these; signatures changed from the pre-Firestore version):
  - `saveVersion(db, name, assignments, layerSettings, timestamp?)` - `async`, returns the new version's Firestore doc id (`string`).
  - `listVersions(db, currentAssignments)` - `async`, returns `{id, name, timestamp, changedCount}[]`, newest first. `changedCount` is `compareAssignments(version.assignments, currentAssignments).length`, computed once per version so the UI doesn't need a second round trip per row.
  - `restoreVersion(db, data, versionId)` - `async`, returns a new data object with `assignments`/`layerSettings` replaced from the named version; throws if `versionId` doesn't exist.
  - `compareAssignments(fromAssignments, toAssignments)` - **unchanged**, still pure, still synchronous.

- [ ] **Step 1: Write the failing tests**

Replace `tests/unit/versions.test.js` (read the existing file first for its current test names/style, then adapt each case to the new async signatures using a real emulator connection):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import {
  saveVersion,
  listVersions,
  restoreVersion,
  compareAssignments,
} from "../../src/versions.js";

const app = initializeApp(
  { projectId: "demo-my-deployment-buddy" },
  "versions-test",
);
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8081);

test("saveVersion() then listVersions() returns it with the right changedCount", async () => {
  const assignments = [{ groupId: "g1", teacherId: "t1", locked: false }];
  const id = await saveVersion(
    db,
    "v1",
    assignments,
    [],
    "2026-01-01T00:00:00Z",
  );
  const versions = await listVersions(db, []); // current has no assignments -> 1 group differs
  const found = versions.find((v) => v.id === id);
  assert.ok(found);
  assert.equal(found.name, "v1");
  assert.equal(found.changedCount, 1);
});

test("listVersions() sorts newest first", async () => {
  await saveVersion(db, "older", [], [], "2020-01-01T00:00:00Z");
  await saveVersion(db, "newer", [], [], "2030-01-01T00:00:00Z");
  const versions = await listVersions(db, []);
  const idxOlder = versions.findIndex((v) => v.name === "older");
  const idxNewer = versions.findIndex((v) => v.name === "newer");
  assert.ok(idxNewer < idxOlder);
});

test("restoreVersion() applies the version's assignments/layerSettings onto data, leaving everything else untouched", async () => {
  const id = await saveVersion(
    db,
    "to-restore",
    [{ groupId: "g2", teacherId: "t2", locked: true }],
    [{ id: "coverage", enabled: true, weight: 1 }],
  );
  const data = { teachers: [{ id: "t2" }], assignments: [], layerSettings: [] };
  const restored = await restoreVersion(db, data, id);
  assert.deepEqual(restored.assignments, [
    { groupId: "g2", teacherId: "t2", locked: true },
  ]);
  assert.deepEqual(restored.layerSettings, [
    { id: "coverage", enabled: true, weight: 1 },
  ]);
  assert.deepEqual(restored.teachers, data.teachers); // untouched
});

test("restoreVersion() throws for an unknown id", async () => {
  const data = { assignments: [], layerSettings: [] };
  await assert.rejects(() => restoreVersion(db, data, "does-not-exist"));
});

test("compareAssignments() reports a group whose teacher changed", () => {
  const from = [{ groupId: "g1", teacherId: "t1", locked: false }];
  const to = [{ groupId: "g1", teacherId: "t2", locked: false }];
  const changes = compareAssignments(from, to);
  assert.deepEqual(changes, [{ groupId: "g1", from: ["t1"], to: ["t2"] }]);
});
```

(Keep every other pre-existing `compareAssignments()` test case from the current file verbatim - that function's behavior and tests are unchanged by this task.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run emulators &` (wait ~5s), then `node --test tests/unit/versions.test.js`
Expected: FAIL - `versions.js` still exports the old pure-array-based signatures.

- [ ] **Step 3: Rewrite `src/versions.js`**

```js
// Deployment memory: named snapshots the HOD can save, list, restore, and
// compare. Versions live in Firestore's deployments/main/versions
// subcollection (not embedded in the main document) so the main document
// never grows unbounded - see
// docs/superpowers/specs/2026-09-29-firestore-sync-design.md.
//
// compareAssignments() is unchanged from before this file's Firestore
// rewrite: pure, synchronous, no storage dependency.

import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

function versionsCollection(db) {
  return collection(db, "deployments", "main", "versions");
}

/**
 * @param {any} db Firestore instance (store.js's getFirestoreDb())
 * @param {string} name
 * @param {{groupId:string, teacherId:string, locked:boolean}[]} assignments
 * @param {{id:string, enabled:boolean, weight:number}[]} layerSettings
 * @param {string} [timestamp] ISO string; defaults to now. Passed explicitly in tests for determinism.
 * @returns {Promise<string>} the new version's Firestore document id
 */
async function saveVersion(
  db,
  name,
  assignments,
  layerSettings,
  timestamp = new Date().toISOString(),
) {
  const ref = await addDoc(versionsCollection(db), {
    name,
    timestamp,
    assignments: deepCopy(assignments),
    layerSettings: deepCopy(layerSettings),
  });
  return ref.id;
}

/**
 * @param {any} db
 * @param {{groupId:string, teacherId:string, locked:boolean}[]} currentAssignments
 * @returns {Promise<{id:string, name:string, timestamp:string, changedCount:number}[]>} newest first
 */
async function listVersions(db, currentAssignments) {
  const snap = await getDocs(versionsCollection(db));
  return snap.docs
    .map((d) => {
      const v = d.data();
      return {
        id: d.id,
        name: v.name,
        timestamp: v.timestamp,
        changedCount: compareAssignments(v.assignments, currentAssignments)
          .length,
      };
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * @param {any} db
 * @param {import('./data.js').default} data
 * @param {string} versionId
 * @returns {Promise<import('./data.js').default>} a new data object
 * @throws {Error} if no version with that id exists
 */
async function restoreVersion(db, data, versionId) {
  const snap = await getDoc(
    doc(db, "deployments", "main", "versions", versionId),
  );
  if (!snap.exists()) {
    throw new Error(`No version with id ${versionId}`);
  }
  const version = snap.data();
  return {
    ...data,
    assignments: deepCopy(version.assignments),
    layerSettings: deepCopy(version.layerSettings),
  };
}

/**
 * Compares two versions (or a version and the current deployment) and
 * returns only the groups whose assigned teacher(s) changed.
 * @param {{groupId:string, teacherId:string, locked:boolean}[]} fromAssignments
 * @param {{groupId:string, teacherId:string, locked:boolean}[]} toAssignments
 * @returns {{groupId:string, from:string[], to:string[]}[]} sorted by groupId
 */
function compareAssignments(fromAssignments, toAssignments) {
  const fromByGroup = groupByGroupId(fromAssignments);
  const toByGroup = groupByGroupId(toAssignments);
  const allGroupIds = new Set([...fromByGroup.keys(), ...toByGroup.keys()]);

  const changes = [];
  for (const groupId of allGroupIds) {
    const from = (fromByGroup.get(groupId) || []).sort();
    const to = (toByGroup.get(groupId) || []).sort();
    if (from.length !== to.length || from.some((t, i) => t !== to[i])) {
      changes.push({ groupId, from, to });
    }
  }
  return changes.sort((a, b) => a.groupId.localeCompare(b.groupId));
}

function groupByGroupId(assignments) {
  const map = new Map();
  for (const a of assignments) {
    if (!map.has(a.groupId)) map.set(a.groupId, []);
    map.get(a.groupId).push(a.teacherId);
  }
  return map;
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

export { saveVersion, listVersions, restoreVersion, compareAssignments };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/unit/versions.test.js` (emulator still running)
Expected: PASS, all tests. Stop the emulator process afterward.

- [ ] **Step 5: Commit**

```bash
git add src/versions.js tests/unit/versions.test.js
git commit -m "feat: move saved versions into a Firestore subcollection"
```

---

### Task 6: Sign-in screen and save-status UI (`index.html`)

**Files:**

- Modify: `index.html:457-471` (wrap the existing `<header>` in `#app-shell`, add `#sign-in-screen`) and `index.html:700` (no script-tag changes needed - Firebase loads via `import` URLs inside the JS files themselves, not `<script>` tags)

**Interfaces:**

- Consumes: nothing code-level (pure markup/CSS); Task 7 wires the new element ids.
- Produces (element ids Task 7 depends on): `#sign-in-screen`, `#sign-in-button`, `#app-shell`, `#save-status`, `#current-user-email`, `#sign-out-button`.

- [ ] **Step 1: Add the sign-in screen and wrap the app shell**

Replace `index.html:457-471`:

```html
old_string (current):
<body>
  <header>
    <h1>My Deployment Buddy</h1>
    <div class="file-actions">
      <button
        id="btn-load-sample"
        title="Load the built-in fictional sample school"
      >
        Load sample
      </button>
      <button id="btn-import">Open from Excel…</button>
      <input type="file" id="file-input" accept=".xlsx" />
      <button id="btn-export">Save to Excel</button>
    </div>
  </header>
</body>
```

```html
new_string:
<body>
  <div id="sign-in-screen">
    <div class="sign-in-card">
      <h1>My Deployment Buddy</h1>
      <p>
        Sign in with your Google account to view and edit the shared deployment.
      </p>
      <button id="sign-in-button" class="primary">Sign in with Google</button>
    </div>
  </div>

  <div id="app-shell" hidden>
    <header>
      <h1>My Deployment Buddy</h1>
      <span id="save-status" class="save-status"></span>
      <span id="current-user-email" class="muted"></span>
      <button id="sign-out-button">Sign out</button>
      <div class="file-actions">
        <button
          id="btn-load-sample"
          title="Load the built-in fictional sample school"
        >
          Load sample
        </button>
        <button id="btn-import">Open from Excel…</button>
        <input type="file" id="file-input" accept=".xlsx" />
        <button id="btn-export">Save to Excel</button>
      </div>
    </header>
  </div>
</body>
```

- [ ] **Step 2: Close the new `#app-shell` wrapper**

Find the existing closing `</body>` (currently `index.html:700`, may have shifted by Step 1's added lines - search for it). Replace:

```html
old_string:
    <!-- Vendored libraries (classic scripts, not ES modules - see CLAUDE.md). -->
    <script src="src/vendor/xlsx/xlsx.full.min.js"></script>
    <script type="module" src="src/ui.js"></script>
  </body>
```

```html
new_string:
    </div>
    <!-- closes #app-shell -->

    <!-- Vendored libraries (classic scripts, not ES modules - see CLAUDE.md). -->
    <script src="src/vendor/xlsx/xlsx.full.min.js"></script>
    <script type="module" src="src/ui.js"></script>
  </body>
```

- [ ] **Step 3: Add CSS for the sign-in screen and save-status indicator**

Add to the existing `<style>` block (near the other component styles, e.g. after the existing `.status` rules):

```css
#sign-in-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}
.sign-in-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 32px;
  max-width: 360px;
  text-align: center;
}
.sign-in-card h1 {
  font-size: 18px;
  margin: 0 0 12px;
}
.sign-in-card p {
  color: var(--muted);
  margin: 0 0 20px;
}
.save-status {
  font-size: 12px;
  color: var(--muted);
}
.save-status.error {
  color: var(--danger);
  font-weight: 600;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
```

- [ ] **Step 4: Verify the page still loads with no console errors**

Run: `npx http-server -p 8080 -c-1 &` then, using a quick headless check:

```bash
node -e "
import('playwright').then(async ({ chromium }) => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8080/index.html');
  await page.waitForSelector('#sign-in-screen');
  console.log('sign-in visible:', await page.locator('#sign-in-screen').isVisible());
  console.log('app-shell hidden:', await page.locator('#app-shell').isHidden());
  console.log('errors:', errors);
  await browser.close();
});
"
```

Expected: `sign-in visible: true`, `app-shell hidden: true`, `errors: []` (module-not-found errors for `src/auth.js` imports inside `src/ui.js` are expected/ignorable here since Task 7 hasn't wired the auth gate yet - only the raw HTML/CSS is being checked in this step).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add sign-in screen and save-status indicator markup"
```

---

### Task 7: Auth-gated boot, async Versions tab, updated onSolve()

**Files:**

- Modify: `src/ui.js` (boot sequence, Versions tab wiring, `onSolve()`)

**Interfaces:**

- Consumes: `onAuthChange`, `getCurrentUser`, `signInWithGoogle`, `signOutUser` (Task 3); `initStore`, `getData`, `setData`, `onChange`, `onSaveStatusChange`, `isBlocked`, `getFirestoreDb` (Task 4); `saveVersion`, `listVersions`, `restoreVersion`, `compareAssignments` (Task 5, new signatures); the element ids from Task 6.
- Produces: nothing new for later tasks (this is the top of the dependency chain within the app code).

- [ ] **Step 1: Update imports and add the auth-gated boot sequence**

Replace `src/ui.js:1-27` (the header comment and import block):

```js
// Browser UI boot: wires together the store (src/ui/store.js) and each tab
// module under src/ui/. Keeps only what doesn't belong to a single tab
// module - the Solve/Layers panel, the Versions tab, file actions (sample
// load / Excel import-export), and boot/tabs.

old_string: import { validate } from "./data.js";
import { buildModel } from "./model.js";
import { solveModel } from "./solve.js";
import { diagnoseInfeasibility } from "./diagnose.js";
import {
  saveVersion,
  listVersions,
  restoreVersion,
  compareAssignments,
} from "./versions.js";
import { exportWorkbook, importWorkbook } from "./excel.js";
import { getLayers } from "./layers/registry.js";

import { esc, genId } from "./ui/dom.js";
import { getData, setData, onChange, isDirty, clearDirty } from "./ui/store.js";
```

```js
// Browser UI boot: gates the app behind Google Sign-In (src/auth.js), then
// wires together the store (src/ui/store.js) and each tab module under
// src/ui/. Keeps only what doesn't belong to a single tab module - the
// Solve/Layers panel, the Versions tab, file actions (sample load / Excel
// import-export), and boot/tabs.

new_string: import { validate } from "./data.js";
import { buildModel } from "./model.js";
import { solveModel } from "./solve.js";
import { diagnoseInfeasibility } from "./diagnose.js";
import {
  saveVersion,
  listVersions,
  restoreVersion,
  compareAssignments,
} from "./versions.js";
import { exportWorkbook, importWorkbook } from "./excel.js";
import { getLayers } from "./layers/registry.js";

import { esc, genId } from "./ui/dom.js";
import {
  initStore,
  getData,
  setData,
  onChange,
  onSaveStatusChange,
  isBlocked,
  getFirestoreDb,
} from "./ui/store.js";
import { onAuthChange, signInWithGoogle, signOutUser } from "./auth.js";
```

- [ ] **Step 2: Update `onSolve()` for the new `saveVersion()` signature**

Replace `src/ui.js`'s `onSolve()` function body (find it - currently starts `async function onSolve() {`):

```js
old_string:
async function onSolve() {
  const btn = document.getElementById("btn-solve");
  btn.disabled = true;
  setStatus("Solving…", "info");
  try {
    // Auto-snapshot before every solve, so a re-solve can always be undone
    // via the Versions tab - re-opening/re-solving must never lose a
    // deployment the HOD already had.
    let working = getData();
    if ((working.assignments || []).length > 0) {
      working = saveVersion(working, "Auto-save before solve");
    }

    const model = buildModel(working);
    const result = await solveModel(model);

    if (result.optimal) {
      setData({
        ...working,
        assignments: result.assignments.map((a) => ({
          ...a,
          locked: wasLocked(working, a),
        })),
      });
      setStatus(
        `Solved. ${result.assignments.length} assignment(s) made.`,
        "ok",
      );
    } else {
      const diagnosis = await diagnoseInfeasibility(working, model);
      setData(working); // Keep the auto-snapshot even though the solve failed.
      setStatus(
        `Could not find a deployment that satisfies every hard constraint:<ul>${diagnosis.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`,
        "error",
      );
    }
  } catch (err) {
    setStatus(
      `Something went wrong while solving: ${esc(err.message)}`,
      "error",
    );
  } finally {
    btn.disabled = false;
  }
}
```

```js
new_string:
async function onSolve() {
  const btn = document.getElementById("btn-solve");
  btn.disabled = true;
  setStatus("Solving…", "info");
  try {
    // Auto-snapshot before every solve, so a re-solve can always be undone
    // via the Versions tab - re-opening/re-solving must never lose a
    // deployment the HOD already had. Versions now save directly to their
    // own Firestore subcollection (Task 5), independent of setData() below
    // - the snapshot is durable as soon as saveVersion() resolves, whether
    // or not the solve itself succeeds.
    const working = getData();
    if ((working.assignments || []).length > 0) {
      await saveVersion(
        getFirestoreDb(),
        "Auto-save before solve",
        working.assignments,
        working.layerSettings,
      );
    }

    const model = buildModel(working);
    const result = await solveModel(model);

    if (result.optimal) {
      setData({
        ...working,
        assignments: result.assignments.map((a) => ({
          ...a,
          locked: wasLocked(working, a),
        })),
      });
      setStatus(
        `Solved. ${result.assignments.length} assignment(s) made.`,
        "ok",
      );
    } else {
      const diagnosis = await diagnoseInfeasibility(working, model);
      setStatus(
        `Could not find a deployment that satisfies every hard constraint:<ul>${diagnosis.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`,
        "error",
      );
    }
  } catch (err) {
    setStatus(
      `Something went wrong while solving: ${esc(err.message)}`,
      "error",
    );
  } finally {
    btn.disabled = false;
  }
}
```

- [ ] **Step 3: Rewrite the Versions tab (`renderVersions`/`wireVersions`) for the async subcollection API**

Replace `src/ui.js`'s `renderVersions()` and `wireVersions()` functions:

```js
old_string: function renderVersions() {
  const data = getData();
  const list = document.getElementById("versions-list");
  const versions = data.versions || [];
  if (versions.length === 0) {
    list.innerHTML = "<li>No saved versions yet.</li>";
    return;
  }
  // Render in original (save) order but show newest first, keeping the
  // original index so Restore/Compare can address versions.js by index.
  const withIndex = versions.map((v, i) => ({ ...v, index: i }));
  withIndex.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  list.innerHTML = withIndex
    .map((v) => {
      const changes = compareAssignments(v.assignments, data.assignments || []);
      return `
      <li>
        <strong>${esc(v.name)}</strong> - <small>${esc(new Date(v.timestamp).toLocaleString())}</small>
        (${changes.length === 0 ? "same as current" : `${changes.length} group(s) differ from current`})
        <button data-action="restore-version" data-index="${v.index}">Restore</button>
      </li>
    `;
    })
    .join("");
}

function wireVersions() {
  document.getElementById("btn-save-version").addEventListener("click", () => {
    const input = document.getElementById("version-name");
    const data = getData();
    const name =
      input.value.trim() || `Version ${(data.versions || []).length + 1}`;
    setData(saveVersion(data, name));
    input.value = "";
  });

  document.getElementById("versions-list").addEventListener("click", (e) => {
    if (e.target.dataset.action !== "restore-version") return;
    const index = Number(e.target.dataset.index);
    if (
      !confirm(
        "Restore this version? Your current (unsaved-as-a-version) changes will be replaced.",
      )
    )
      return;
    setData(restoreVersion(getData(), index));
  });
}
```

```js
new_string: function renderVersions() {
  const list = document.getElementById("versions-list");
  list.innerHTML = "<li>Loading versions…</li>";
  const data = getData();
  listVersions(getFirestoreDb(), data.assignments || []).then((versions) => {
    if (versions.length === 0) {
      list.innerHTML = "<li>No saved versions yet.</li>";
      return;
    }
    list.innerHTML = versions
      .map(
        (v) => `
      <li>
        <strong>${esc(v.name)}</strong> - <small>${esc(new Date(v.timestamp).toLocaleString())}</small>
        (${v.changedCount === 0 ? "same as current" : `${v.changedCount} group(s) differ from current`})
        <button data-action="restore-version" data-id="${esc(v.id)}">Restore</button>
      </li>
    `,
      )
      .join("");
  });
}

function wireVersions() {
  document
    .getElementById("btn-save-version")
    .addEventListener("click", async () => {
      const input = document.getElementById("version-name");
      const data = getData();
      const name = input.value.trim() || "Version";
      await saveVersion(
        getFirestoreDb(),
        name,
        data.assignments,
        data.layerSettings,
      );
      input.value = "";
      renderVersions();
    });

  document
    .getElementById("versions-list")
    .addEventListener("click", async (e) => {
      if (e.target.dataset.action !== "restore-version") return;
      const versionId = e.target.dataset.id;
      if (
        !confirm(
          "Restore this version? Your current (unsaved-as-a-version) changes will be replaced.",
        )
      )
        return;
      const restored = await restoreVersion(
        getFirestoreDb(),
        getData(),
        versionId,
      );
      setData(restored);
    });
}
```

- [ ] **Step 4: Add the save-status renderer and the auth-gated boot**

Replace `src/ui.js`'s existing `init()` function and its bottom boot block (the `if (typeof document !== "undefined") { ... }` block):

```js
old_string: function init() {
  initTabs();
  wireSubjects();
  wireClasses();
  wireBands();
  wireTeachers();
  wireGroups();
  wireLayers();
  wireDeployment();
  wireVersions();
  wireFileActions();
  onChange(renderAll);
  renderAll();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
```

```js
new_string: function renderSaveStatus({ status, message }) {
  const box = document.getElementById("save-status");
  if (!box) return;
  const labels = {
    idle: "",
    saving: "Saving…",
    saved: "Saved",
    conflict: `⚠ ${message}`,
    error: `⚠ ${message}`,
    blocked: message || "Reload the page to continue.",
  };
  box.textContent = labels[status] || "";
  box.classList.toggle(
    "error",
    status === "conflict" || status === "error" || status === "blocked",
  );
}

let wired = false;

async function onSignedIn(user) {
  document.getElementById("sign-in-screen").hidden = true;
  const shell = document.getElementById("app-shell");
  shell.hidden = false;
  document.getElementById("current-user-email").textContent = user.email;

  try {
    await initStore();
  } catch (err) {
    alert(
      `Could not load the deployment from the cloud: ${err.message}\n\nCheck your internet connection and that your account has access.`,
    );
    return;
  }

  if (!wired) {
    wired = true;
    onSaveStatusChange(renderSaveStatus);
    initTabs();
    wireSubjects();
    wireClasses();
    wireBands();
    wireTeachers();
    wireGroups();
    wireLayers();
    wireDeployment();
    wireVersions();
    wireFileActions();
    onChange(renderAll);
  }
  renderAll();
}

function onSignedOut() {
  document.getElementById("sign-in-screen").hidden = false;
  document.getElementById("app-shell").hidden = true;
}

function boot() {
  document.getElementById("sign-in-button").addEventListener("click", () => {
    signInWithGoogle().catch((err) => alert(`Sign-in failed: ${err.message}`));
  });
  document
    .getElementById("sign-out-button")
    .addEventListener("click", () => signOutUser());

  onAuthChange((user) => {
    if (user) onSignedIn(user);
    else onSignedOut();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
```

- [ ] **Step 5: Update `wireFileActions()` - remove the `isDirty`/`clearDirty` beforeunload check**

`isDirty()`/`clearDirty()` no longer exist on `store.js` (Task 4 removed them - every write now goes straight to Firestore, so there's no "unsaved local-only" state to warn about the way localStorage had). Replace `src/ui.js`'s `wireFileActions()`:

```js
old_string: document
  .getElementById("btn-export")
  .addEventListener("click", () => {
    exportWorkbook(getData(), "deployment.xlsx");
    clearDirty();
  });
```

```js
new_string: document
  .getElementById("btn-export")
  .addEventListener("click", () => {
    exportWorkbook(getData(), "deployment.xlsx");
  });
```

And:

```js
old_string: clearDirty();
setData(imported);
```

```js
new_string: setData(imported);
```

And remove the trailing `beforeunload` block entirely:

```js
old_string:
  window.addEventListener("beforeunload", (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });
}
```

```js
new_string:
}
```

- [ ] **Step 6: Run the full e2e suite to confirm Tasks 3-7 work together**

Run:

```bash
npm run emulators &
sleep 5
npx http-server -p 8080 -c-1 &
sleep 1
npx playwright test tests/e2e/store.spec.js tests/e2e/auth.spec.js
```

Expected: PASS, all tests from Tasks 3 and 4's e2e specs now fully green (Task 4's `store.spec.js` was left red at the end of Task 4 specifically because it needed this task's sign-in UI/wiring). Stop both background processes afterward.

- [ ] **Step 7: Commit**

```bash
git add src/ui.js
git commit -m "feat: gate app boot behind Google Sign-In, wire save-status and async Versions tab"
```

---

### Task 8: Remove the localStorage code path from `src/data.js`

**Files:**

- Modify: `src/data.js:24, 485-538` (remove `STORAGE_KEY`, `loadFromStorage`, `saveToStorage`)
- Modify: `tests/unit/data.test.js` (remove their test cases)

**Interfaces:**

- Consumes: nothing (Task 4 already stopped importing these in Task 4 Step 3).
- Produces: nothing new; `emptyData`, `validate`, `migrateV1`, `effectiveCap` stay exported unchanged.

- [ ] **Step 1: Confirm nothing still imports the functions being removed**

Run: `grep -rn "loadFromStorage\|saveToStorage\|STORAGE_KEY" src/ tests/ index.html`
Expected: only matches inside `src/data.js` itself and `tests/unit/data.test.js` (the two files this task modifies). If anything else matches, stop and report it rather than deleting code something still depends on.

- [ ] **Step 2: Remove the test cases for the functions being deleted**

Open `tests/unit/data.test.js`, remove every `test(...)` block whose name mentions `loadFromStorage` or `saveToStorage` (there are several - the "returns emptyData() on missing key" / "corrupt JSON" / "invalid shape" / "migrates v1-shaped..." / "round-trips valid v2 data" / "returns false ... setItem throws" cases, and the `makeMemoryStorage()` helper if nothing else in the file uses it after these are removed - check with `grep -n "makeMemoryStorage" tests/unit/data.test.js` after removing the test blocks).

- [ ] **Step 3: Run it to verify the remaining tests still pass (RED check for the deletion target, not a new feature)**

Run: `node --test tests/unit/data.test.js`
Expected: PASS (the removed tests are gone, not failing; this step confirms nothing else in the file broke from the edit).

- [ ] **Step 4: Remove `STORAGE_KEY`, `loadFromStorage`, `saveToStorage` from `src/data.js`**

Delete lines `src/data.js:485-532` (the full `loadFromStorage`/`saveToStorage` function bodies, found via the `grep -n` output from Step 1 of this task) and remove `loadFromStorage`, `saveToStorage`, `STORAGE_KEY` from the `export { ... }` block at the bottom of the file. Also remove the now-unused `const STORAGE_KEY = "deploymentBuddy.v2";` line near the top (`src/data.js:24`).

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS, 0 failures (matches the pre-this-task baseline count minus the removed test cases).

- [ ] **Step 6: Commit**

```bash
git add src/data.js tests/unit/data.test.js
git commit -m "chore: remove localStorage persistence from data.js (Firestore is now the source of truth)"
```

---

### Task 9: Point e2e tests at the emulator suite; add the Review Focus tests

**Files:**

- Modify: `playwright.config.js`
- Modify: `tests/e2e/deployment.spec.js` (add a sign-in step to every existing flow; add 2 new tests)

**Interfaces:**

- Consumes: everything from Tasks 1-7.
- Produces: nothing (final integration task before docs).

- [ ] **Step 1: Add the emulator suite as a second `webServer`**

Replace `playwright.config.js`:

```js
old_string: import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Small local suite; keep it simple and deterministic.
  reporter: "list",
  use: {
    baseURL: "http://localhost:8080",
  },
  webServer: {
    command: "npx http-server -p 8080 -c-1 --silent",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
  },
});
```

```js
new_string: import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Small local suite; keep it simple and deterministic.
  reporter: "list",
  use: {
    baseURL: "http://localhost:8080",
  },
  webServer: [
    {
      command: "npx http-server -p 8080 -c-1 --silent",
      url: "http://localhost:8080",
      reuseExistingServer: !process.env.CI,
      timeout: 30 * 1000,
    },
    {
      command:
        "npx firebase emulators:start --project demo-my-deployment-buddy",
      url: "http://127.0.0.1:4000",
      reuseExistingServer: !process.env.CI,
      timeout: 60 * 1000,
    },
  ],
});
```

- [ ] **Step 2: Add a shared sign-in helper and use it in every existing test**

Read `tests/e2e/deployment.spec.js` fully first (it already has a pattern for shared setup, per its existing structure) and add near the top, alongside any existing helpers:

```js
async function signInAsHod(page) {
  await page.goto("/index.html?emulators=1");
  await page.click("#sign-in-button");
  await expect(page.locator("#app-shell")).toBeVisible({ timeout: 10000 });
}
```

Replace every existing test's opening `await page.goto("/index.html")` (or equivalent) with `await signInAsHod(page)`.

- [ ] **Step 3: Write the failing "unauthorized email" test**

Add to `tests/e2e/deployment.spec.js`:

```js
test("signing in with an email not on the allowlist is rejected with a clear message, not a blank app", async ({
  page,
}) => {
  await page.goto("/index.html?emulators=1");
  // The Auth emulator's default test account for this harness is
  // hod@example.com (matching firestore.rules); force a different,
  // non-allowlisted identity via the same sign-in flow's account picker.
  await page.click("#sign-in-button");
  await expect(page.locator("#app-shell")).toBeVisible({ timeout: 10000 });
  // Signed in, but Firestore denies every read/write for this identity -
  // initStore() must surface that as a message, not a silent blank page.
  await expect(page.locator("body")).toContainText(
    /could not load the deployment/i,
    { timeout: 10000 },
  );
});
```

- [ ] **Step 4: Write the failing "reload never re-solves" regression test for the new backend**

Add to `tests/e2e/deployment.spec.js` (this re-verifies the project's core non-negotiable under Firestore, per Review Focus):

```js
test("reloading after a solve still never triggers a re-solve, now that data loads from Firestore", async ({
  page,
}) => {
  await signInAsHod(page);
  await page.click("#btn-load-sample");
  await page.click('[data-tab="layers"]');
  await page.click("#btn-solve");
  await expect(page.locator("#solve-status")).toContainText("Solved", {
    timeout: 15000,
  });
  const assignedBefore = await page
    .locator('[data-action="reassign"]')
    .evaluateAll((els) => els.map((el) => el.value));

  await page.reload();
  await expect(page.locator("#app-shell")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#solve-status")).not.toContainText("Solving");
  const assignedAfter = await page
    .locator('[data-action="reassign"]')
    .evaluateAll((els) => els.map((el) => el.value));
  expect(assignedAfter).toEqual(assignedBefore);
});
```

- [ ] **Step 5: Run the two new tests from Steps 3-4**

Run: `npx playwright test -g "not on the allowlist|never triggers a re-solve"`
Expected: both the behaviors under test were already built in Tasks 4 and 7 (the transaction's rejection surfaces through `initStore()`'s existing catch block; the reload path already re-fetches from Firestore with no solver call) - so these tests are expected to PASS immediately, confirming those two Review Focus items as real, working regression guards rather than untested claims. If either fails, that's a genuine gap in Tasks 4/7 - use systematic debugging to find and fix it there (not by weakening the test).

- [ ] **Step 6: Confirm the whole suite passes**

Run: `npx playwright test`
Expected: PASS, every test in `tests/e2e/deployment.spec.js`, `tests/e2e/auth.spec.js`, and `tests/e2e/store.spec.js`.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.js tests/e2e/deployment.spec.js
git commit -m "test: run e2e suite against the Firebase emulator suite; add allowlist and reload-never-resolves regression tests"
```

---

### Task 10: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing (documentation only).

- [ ] **Step 1: Update the two superseded non-negotiables and add the allowlist line**

In `CLAUDE.md`'s "Non-negotiables" section, find the bullet starting `- **The solver runs entirely offline.**` and replace it:

```markdown
old_string:

- **The solver runs entirely offline.** HiGHS WASM is vendored in
  `src/vendor/highs/` (copied from `node_modules/highs/build/`, not
  imported live) so the page works with no internet at school.
```

```markdown
new_string:

- **The HiGHS solve itself runs entirely offline.** HiGHS WASM is vendored
  in `src/vendor/highs/` (copied from `node_modules/highs/build/`, not
  imported live) so solving never needs a network call. The app as a
  whole, however, now requires internet connectivity to load/save the
  deployment (see Firestore sync below) - this is a deliberate trade
  made when shared editing was added; it is not an oversight.
```

Find the bullet starting `- **No real student/teacher data in the repo.**` and, immediately after it (still inside the Non-negotiables list), replace the localStorage/Excel line:

```markdown
old_string:

- **No real student/teacher data in the repo.** The repo and the hosted page
  only ever contain code and the fictional `sample/` school. Real deployment
  data lives in the HOD's browser (localStorage) and the Excel file they
  carry. Check `.gitignore` before adding any file that might contain real
  names.
```

```markdown
new_string:

- **No real student/teacher data in the repo.** The repo and the hosted page
  only ever contain code and the fictional `sample/` school. Real deployment
  data lives in Firestore, shared between the HOD and their co-HOD via
  Google Sign-In; access is restricted to a hardcoded two-email allowlist
  enforced in `firestore.rules` (expanding access means editing that file
  and re-pasting it into the Firebase console - never app code). Excel
  export/import remains as a portability/backup format, not the primary
  store. Check `.gitignore` before adding any file that might contain real
  names.
```

- [ ] **Step 2: Update the "Key files" table**

Find the table row for `src/versions.js` (if present) or add rows for the new files, matching the table's existing column format (`File | Responsibility`):

```markdown
| `src/auth.js` | Google Sign-In wrapper (Firebase Auth). Gates app boot. |
| `src/ui/store.js` | Single source of truth for in-memory `data`, backed by Firestore (`deployments/main`), with an optimistic-local + transactional overwrite guard. |
| `src/versions.js` | Saved-version snapshots, stored in the `deployments/main/versions` Firestore subcollection. |
| `firestore.rules` | Security rules restricting all access to the two-email allowlist. |
```

- [ ] **Step 3: Verify the doc reads coherently**

Read the full updated `CLAUDE.md` once, front to back, to confirm no contradictory statement remains (e.g., no other bullet still claims "the app works with no internet" elsewhere in the file).
Expected: no contradictions found. If one is found, fix it inline.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md non-negotiables for Firestore-backed shared editing"
```

---

## Final Verification

After Task 10:

1. Run `npm test` - expect all unit tests passing, 0 failures.
2. Run `npm run test:rules` - expect all 4 security-rules tests passing.
3. Run `npm run emulators &`, wait, then `npx http-server -p 8080 -c-1 &`, then `npx playwright test` - expect every e2e test passing (deployment flows + auth + store + the two new Review Focus tests). Stop both background processes.
4. Manually (the user, not an agent): create a real Firebase project, replace the placeholder values in `src/firebase-config.js` and the two placeholder emails in `firestore.rules`, paste the rules into the Firebase console, and open the deployed GitHub Pages URL without `?emulators=1` to confirm real Google Sign-In and Firestore work end-to-end. This step needs the user's own Google account emails and cannot be scripted by an agent.
