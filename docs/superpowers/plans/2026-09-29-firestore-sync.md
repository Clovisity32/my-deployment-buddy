# Firestore Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the HOD and one co-HOD open My Deployment Buddy from any device, sign in with Google, and see/edit the same live deployment, replacing the current localStorage-only, single-browser data model.

**Architecture:** Firestore stores the deployment as one document (`deployments/main`, everything except `versions`) plus a `versions` subcollection (one doc per saved snapshot, so the main document never grows unbounded). `src/ui/store.js` keeps its exact current `getData()`/`setData()`/`onChange()` public API — every tab UI module (`subjects.js`, `classes.js`, `bands.js`, `teachers.js`, `groups.js`, `deployment.js`) needs zero changes — only the store's internals swap from `localStorage` to Firestore, with an optimistic local cache (instant UI updates) backed by an async write with a transaction-based overwrite guard. Google Sign-In (Firebase Auth) gates the app; Firestore security rules restrict access to a two-email allowlist.

**Tech Stack:** Firebase JS SDK v10 (modular; browser code imports it via bare specifiers - `"firebase/app"`, `"firebase/auth"`, `"firebase/firestore"` - resolved by a native browser import map pointing at the `gstatic.com` ESM CDN, so the same source files also resolve those specifiers through `node_modules/firebase` under plain `node --test`, with no bundler and no experimental Node flags), a **real, separate Firebase "test" project** (no Local Emulator Suite - this dev machine has no Java, which the emulator suite requires, and the user chose not to install one), `firebase-admin` for minting custom sign-in tokens and deploying security rules programmatically in tests, `firebase-tools` as a devDependency (occasionally useful for `firebase login`/`firebase projects:list`, not required by any test).

**Spec:** `docs/superpowers/specs/2026-09-29-firestore-sync-design.md`

## Global Constraints

- No build step for the shipped site: every `src/` file stays a native ES module loadable via `<script type="module">` and (where applicable) `node --test`. Firebase is loaded via bare specifiers resolved by an import map, never bundled into the shipped page.
- No real student/teacher data in the repo (`sample/sample.json` stays fictional). Real Firebase config values (API key, project ID) ARE committed - they are public client identifiers, not secrets; security rules are what protects the data. A downloaded service-account JSON key is NEVER committed (`.gitignore`'d in Task 1) - it is a real secret, unlike the client config values.
- The app now requires internet connectivity to load/save deployment data (this project's prior "solver runs entirely offline" guarantee is deliberately narrowed to "the HiGHS solve itself is offline" - see spec).
- Access is restricted to exactly two Google account emails, enforced server-side in `firestore.rules` - never trust a client-side check alone.
- Every value interpolated into `innerHTML` (including attributes) goes through `esc()` from `src/ui/dom.js`, per this project's existing convention.
- Automated tests NEVER touch the real/production Firebase project - they run exclusively against a separate, dedicated test project (`src/firebase-config.js`'s `testConfig`, selected via `?test=1`), so a bug in a test can never corrupt a real HOD's actual saved deployment.
- `npm test` (the `tests/unit/**` glob) stays fast, offline, and network-free - exactly as it is today. Every test that needs the real test Firebase project (network + `FIREBASE_TEST_SERVICE_ACCOUNT`) lives under `tests/integration/` instead, run via the separate `npm run test:integration` script, never swept into `npm test`.

## Review Focus

- A save that races another save (both HOD and co-HOD editing near-simultaneously) must never silently drop one person's change - the overwrite guard's transaction must be exercised with a real concurrent write in a test, not just asserted about in isolation.
- Signing in as a Google account NOT on the two-email allowlist must be cleanly rejected (clear message, no partial data leak) - tested against the real deployed `firestore.rules` on the real test project, not just described in the file.
- Reloading the page after a successful solve must still never trigger a re-solve, now that data loads from Firestore instead of localStorage - this project's core non-negotiable, re-verified under the new backend.
- Restoring a saved version must work with the new subcollection-backed `versions.js` API exactly as it did with the old array-based one (same assignments/layerSettings end up applied) - a version saved before this change has no equivalent (out of scope per spec), but a version saved and restored entirely within the new system must round-trip exactly.
- A network/Firestore error while loading (e.g., the test project is unreachable, or a permission-denied from the rules) must show the HOD a clear, actionable message instead of a blank page or a raw stack trace in the console.

---

## File Structure

- **Create** `tests/support/admin.js` - Firebase Admin SDK helpers (mint a custom sign-in token for a given email; programmatically deploy `firestore.rules` to the test project), used only by `tests/integration/*` and `tests/e2e/*`, never shipped.
- **Create** `firestore.rules` - the two-email allowlist security rules.
- **Create** `src/firebase-config.js` - two Firebase project configs (production + a separate test project) + a `?test=1` query-param switch, so the same static file (no build step) can point at either.
- **Create** `src/auth.js` - Firebase Auth wrapper: Google sign-in/out, current-user state, plus `signInWithToken()` for tests.
- **Modify** `src/ui/store.js` - swap localStorage for Firestore, add the overwrite guard and save-status API.
- **Modify** `src/versions.js` - swap the embedded `data.versions` array for the `deployments/main/versions` subcollection.
- **Modify** `index.html` - add a sign-in screen, a save-status indicator, wrap the existing app markup in a hideable `#app-shell`, add the Firebase import map.
- **Modify** `src/ui.js` - auth-gated boot sequence; async-aware Versions tab wiring; `onSolve()` updated for the new `saveVersion()` signature; exposes a test-only `window.__signInWithToken` hook when `useTestProject` is true.
- **Modify** `src/data.js` - remove `loadFromStorage`/`saveToStorage`/`STORAGE_KEY` (no longer meaningful; Firestore is now the source of truth).
- **Modify** `tests/e2e/deployment.spec.js` - sign in via a minted custom token before each flow; add the conflict-guard and unauthorized-email tests from Review Focus.
- **Modify** `CLAUDE.md` - the two superseded non-negotiables + the new allowlist line, per the spec.
- **Create** `tests/integration/firestore-rules.test.js`, `tests/integration/test-firebase-config.js` - security-rules tests against the real test project.
- **Modify** `tests/unit/data.test.js` - remove the now-deleted `loadFromStorage`/`saveToStorage` test cases.
- **Modify** `tests/unit/versions.test.js` → **move to** `tests/integration/versions.test.js` - now needs the real test project (network + auth), so it moves out of the fast/offline `tests/unit/` suite.
- **Modify** `package.json` - new devDependencies (`firebase`, `firebase-tools`, `firebase-admin`) and a `test:integration` script.
- **Modify** `.gitignore` - the service-account key file pattern.

---

### Task 1: Test-project scaffolding (no local emulator)

This plan does NOT use the Firebase Local Emulator Suite (it requires a JRE; this machine has none, and the user chose not to install one - see the ledger). Instead, every automated test that needs auth/Firestore runs against a real, **separate Firebase "test" project** (free, distinct from whatever real project the HOD eventually deploys with), signing in via a **service-account-minted custom token** instead of a real Google OAuth popup (which headless browsers can't reliably automate) - this is Firebase's own documented pattern for testing Auth-gated apps without emulators.

**Prerequisite (the user, not an agent, does this once before Task 2 can run for real):** create a second Firebase project dedicated to testing, enable Firestore and the Google Auth provider on it, and download a service-account JSON key (Firebase console → Project settings → Service accounts → Generate new private key). Set an environment variable `FIREBASE_TEST_SERVICE_ACCOUNT` pointing at that downloaded file's path before running `npm run test:integration` or the e2e suite. This task's own steps don't require the key to exist yet (they only install tooling and write helper code) - Task 2 is the first task whose tests actually need it.

**Files:**

- Create: `tests/support/admin.js`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: nothing (first task).
- Produces (Tasks 2, 3, 9 import these): `mintCustomToken(email)` - `async`, ensures a Firebase Auth user with that email exists in the test project (creating one if needed) and returns a custom token string for it. `deployFirestoreRules()` - `async`, pushes the current `firestore.rules` file's content live on the test project via the Admin SDK's Security Rules API, so rules tests always exercise the exact file on disk, never a stale deploy.

- [ ] **Step 1: Install the tooling**

```bash
npm install --save-dev firebase firebase-tools firebase-admin
npm view firebase version
```

Note the printed version (e.g. `10.14.1`) - Task 6's `index.html` import map (and every standalone test fixture's copy of it) pins this exact version in its `gstatic.com` CDN URLs; it is the ONLY place a version string appears (source files import bare `"firebase/*"` specifiers, never a versioned URL directly - see Task 3's note on why). If it differs from `10.14.1` used below, use the actual installed version consistently in every import map in this plan. (`firebase-tools` is kept as a devDependency even without emulators - it's occasionally useful for `firebase login`/`firebase projects:list` during setup - but no `firebase.json`/emulator config is needed since nothing in this plan calls `firebase emulators:*` or `firebase deploy` anymore; rules deploy happens programmatically via `firebase-admin`, Step 2 below.)

- [ ] **Step 2: Create `tests/support/admin.js`**

```js
// Node-only helper (never imported by browser code) wrapping the Firebase
// Admin SDK against the TEST Firebase project - never the real/production
// one. Lets automated tests (a) sign in as a specific identity without a
// real Google OAuth popup, and (b) push the current firestore.rules file
// live before asserting against it. See
// docs/superpowers/specs/2026-09-29-firestore-sync-design.md and this
// plan's Task 1.
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getSecurityRules } from "firebase-admin/security-rules";
import { readFileSync } from "node:fs";

function adminApp() {
  const existing = getApps().find((a) => a.name === "test-admin");
  if (existing) return existing;
  const keyPath = process.env.FIREBASE_TEST_SERVICE_ACCOUNT;
  if (!keyPath) {
    throw new Error(
      "FIREBASE_TEST_SERVICE_ACCOUNT env var is not set - point it at your TEST Firebase project's downloaded service-account JSON key file (see Task 1's prerequisite note).",
    );
  }
  const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));
  return initializeApp({ credential: cert(serviceAccount) }, "test-admin");
}

/**
 * Ensures a Firebase Auth user with this email exists in the test project
 * (creating one if not) and returns a custom token for it.
 * @param {string} email
 * @returns {Promise<string>}
 */
async function mintCustomToken(email) {
  const auth = getAuth(adminApp());
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email });
  }
  return auth.createCustomToken(user.uid);
}

/** Pushes the current firestore.rules file live on the test project. */
async function deployFirestoreRules() {
  const rules = getSecurityRules(adminApp());
  const rulesFile = rules.createRulesFileFromSource(
    readFileSync("firestore.rules", "utf8"),
  );
  const ruleset = await rules.createRuleset(rulesFile);
  await rules.releaseFirestoreRuleset(ruleset);
}

export { mintCustomToken, deployFirestoreRules };
```

- [ ] **Step 3: Add the `test:integration` npm script**

In `package.json`, add to `"scripts"`:

```json
"test:integration": "node --test tests/integration/*.test.js"
```

(No emulator wrapper needed - this talks directly to the real test project over the network, so it needs `FIREBASE_TEST_SERVICE_ACCOUNT` set and internet access.)

- [ ] **Step 4: Add the service-account key to `.gitignore`**

Add to `.gitignore`:

```
# Firebase test-project service-account key - never commit (see
# docs/superpowers/specs/2026-09-29-firestore-sync-design.md)
firebase-service-account*.json
```

- [ ] **Step 5: Verify the file is syntactically sound**

Run: `node --check tests/support/admin.js`
Expected: no output (exits 0) - confirms valid JS syntax. Actually calling `mintCustomToken`/`deployFirestoreRules` requires a real service-account key, which doesn't exist yet at this point in the plan - Task 2's own test run is this file's real functional checkpoint.

- [ ] **Step 6: Commit**

```bash
git add tests/support/admin.js package.json package-lock.json .gitignore
git commit -m "chore: add Firebase Admin SDK test helpers (custom-token sign-in, rules deploy) - no local emulator"
```

---

### Task 2: Firestore security rules

**Files:**

- Create: `firestore.rules`
- Create: `tests/integration/test-firebase-config.js` (a small, self-contained client config for the TEST project - see note below)
- Test: `tests/integration/firestore-rules.test.js`

**Interfaces:**

- Consumes: `mintCustomToken`, `deployFirestoreRules` from `tests/support/admin.js` (Task 1).
- Produces: `firestore.rules`, deployed programmatically to the real test project by this task's own test (via `deployFirestoreRules()`, Task 1) - always exercising the exact file on disk. The production Firebase project needs these rules pasted into its console manually (documented in a comment in the file itself - this project has no CI/CD pipeline to auto-deploy rules there).

This task's test is a standalone Node script that talks to the real client SDK (`firebase/firestore`, `firebase/auth`) against the TEST project, so it needs that project's client config (`apiKey`/`authDomain`/`projectId` - NOT the service-account key, a different, non-secret set of values). Rather than depend on Task 3 (which creates `src/firebase-config.js`, not written yet at this point in the plan), this task carries its own minimal copy in `tests/integration/test-firebase-config.js` - Task 3's note explains why this small duplication is intentional.

- [ ] **Step 1: Create `tests/integration/test-firebase-config.js`**

```js
// Minimal client config for the TEST Firebase project, used only by
// tests/integration/firestore-rules.test.js. This project's real firebaseConfig
// (Task 3, src/firebase-config.js) has its own copy of the same test
// project's values - kept in sync manually; both are non-secret public
// client identifiers (see docs/superpowers/specs/2026-09-29-firestore-sync-design.md).
//
// PRODUCTION SETUP: replace with your TEST project's config (Firebase
// console -> Project settings -> General -> Your apps -> Web app). Match
// this to src/firebase-config.js's testConfig once Task 3 exists.
const testFirebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_TEST_FIREBASE_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_TEST_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_TEST_PROJECT_ID",
};

export { testFirebaseConfig };
```

- [ ] **Step 2: Write the failing rules tests**

Create `tests/integration/firestore-rules.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  addDoc,
} from "firebase/firestore";
import { getAuth, signInWithCustomToken, signOut } from "firebase/auth";
import { mintCustomToken, deployFirestoreRules } from "../support/admin.js";
import { testFirebaseConfig } from "./test-firebase-config.js";

const ALLOWED_EMAILS = ["hod@example.com", "cohod@example.com"];

const app = initializeApp(testFirebaseConfig, "rules-test");
const db = getFirestore(app);
const auth = getAuth(app);

/** Resolves once, or throws Firestore's own "permission-denied" error. */
async function expectDenied(promise) {
  await assert.rejects(promise, (err) => err.code === "permission-denied");
}

test.before(async () => {
  await deployFirestoreRules();
});

test.after(async () => {
  await signOut(auth);
});

test("an allowed email can read and write deployments/main", async () => {
  const token = await mintCustomToken(ALLOWED_EMAILS[0]);
  await signInWithCustomToken(auth, token);
  await setDoc(doc(db, "deployments/main"), { roles: [] });
  const snap = await getDoc(doc(db, "deployments/main"));
  assert.ok(snap.exists());
});

test("an allowed email can read and write a version in the versions subcollection", async () => {
  const token = await mintCustomToken(ALLOWED_EMAILS[0]);
  await signInWithCustomToken(auth, token);
  const ref = await addDoc(collection(db, "deployments/main/versions"), {
    name: "v1",
    timestamp: new Date().toISOString(),
    assignments: [],
    layerSettings: [],
  });
  await deleteDoc(ref); // keep the test project tidy across repeated runs
});

test("an email not on the allowlist is denied", async () => {
  const token = await mintCustomToken("stranger@example.com");
  await signInWithCustomToken(auth, token);
  await expectDenied(setDoc(doc(db, "deployments/main"), { roles: [] }));
  await expectDenied(getDoc(doc(db, "deployments/main")));
});

test("an unauthenticated request is denied", async () => {
  await signOut(auth);
  await expectDenied(getDoc(doc(db, "deployments/main")));
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npm run test:integration` (using the real path to the key downloaded per Task 1's prerequisite; replace the placeholder values in `tests/integration/test-firebase-config.js` with your real test project's config first)
Expected: FAIL - `firestore.rules` does not exist yet, so `deployFirestoreRules()` in `test.before` throws (file not found).

- [ ] **Step 4: Write `firestore.rules`**

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

- [ ] **Step 5: Run it to verify it passes**

Run: `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npm run test:integration`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules tests/integration/test-firebase-config.js tests/integration/firestore-rules.test.js
git commit -m "feat: add Firestore security rules restricting access to a two-email allowlist"
```

---

### Task 3: Google Sign-In (`src/auth.js`)

**Files:**

- Create: `src/firebase-config.js`
- Create: `src/auth.js`
- Test: `tests/e2e/auth.spec.js`

**Interfaces:**

- Consumes: `mintCustomToken` from `tests/support/admin.js` (Task 1, test-only).
- Produces (for Tasks 4, 5, 7 to import):
  - `src/firebase-config.js`: `export { firebaseConfig, useTestProject }` - `firebaseConfig` picks between two real Firebase projects' configs based on `useTestProject`, a boolean driven by an `?test=1` query param (real HODs never pass it; automated tests always do).
  - `src/auth.js`: `export { app, onAuthChange, getCurrentUser, signInWithGoogle, signInWithToken, signOutUser }` where:
    - `app` - the initialized Firebase App instance (Task 4/5 call `getFirestore(app)` with it).
    - `onAuthChange(fn)` - registers `fn(user | null)`, called once immediately with the current state and again on every sign-in/out. `user` is `{email, uid}`.
    - `getCurrentUser()` - returns `{email, uid} | null` synchronously (the last value `onAuthChange` delivered).
    - `signInWithGoogle()` - `async`, throws on failure/popup-closed. The real production sign-in path.
    - `signInWithToken(token)` - `async`, signs in with a pre-minted custom token (from `mintCustomToken`) instead of a popup. Test-only in practice, but a real, generally-useful Auth capability - not test scaffolding bolted onto the type system.
    - `signOutUser()` - `async`.

- [ ] **Step 1: Create `src/firebase-config.js`**

```js
// Firebase project configs. These values are public client identifiers,
// not secrets - safe to commit. Access is protected by firestore.rules,
// not by hiding these. See
// docs/superpowers/specs/2026-09-29-firestore-sync-design.md "Auth &
// access control".
//
// PRODUCTION SETUP: replace productionConfig with your real Firebase
// project's config, and testConfig with a SEPARATE, dedicated test
// project's config (Firebase console -> Project settings -> General ->
// Your apps -> Web app, for each project) - automated tests must never
// touch the real project's data. Keep testConfig in sync with
// tests/integration/test-firebase-config.js's copy (Task 2).
const productionConfig = {
  apiKey: "REPLACE_WITH_YOUR_FIREBASE_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
};

const testConfig = {
  apiKey: "REPLACE_WITH_YOUR_TEST_FIREBASE_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_TEST_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_TEST_PROJECT_ID",
};

// Opt into the separate test project via a query param, e.g.
// index.html?test=1 - no build step, no env vars, works identically
// whether the file is opened locally or served from GitHub Pages. Real
// HODs never pass this; automated tests always do.
const useTestProject =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("test");

const firebaseConfig = useTestProject ? testConfig : productionConfig;

export { firebaseConfig, useTestProject };
```

- [ ] **Step 2: Create `src/auth.js`**

```js
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

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

/**
 * Signs in with a pre-minted custom token instead of a real Google popup.
 * Real HODs never call this - the UI never exposes a button for it. Used
 * only by automated tests (via tests/support/admin.js's mintCustomToken(),
 * Task 1) against the separate test project, since headless browsers can't
 * reliably drive a real Google OAuth consent screen.
 * @param {string} token
 */
async function signInWithToken(token) {
  await signInWithCustomToken(auth, token);
}

async function signOutUser() {
  await signOut(auth);
}

export {
  app,
  onAuthChange,
  getCurrentUser,
  signInWithGoogle,
  signInWithToken,
  signOutUser,
};
```

`auth.js` imports `"firebase/app"`/`"firebase/auth"` as bare specifiers, not full `gstatic.com` URLs. This is deliberate: `src/versions.js` (Task 5) is loaded both by the browser AND directly by `node --test` (it has a plain Node unit test), and Node's default ES module loader cannot resolve a bare `https://` URL import without an experimental flag this project doesn't want to depend on. Every Firebase-importing file in this plan (`auth.js`, `store.js`, `versions.js`) uses the same bare specifiers; the browser resolves them via an **import map** (Task 6 adds one to `index.html`; every standalone test fixture HTML file needs its own copy, since import maps are per-document) mapping to the pinned `gstatic.com` CDN version, while Node resolves the identical specifiers straight through `node_modules/firebase` (installed in Task 1). One version string, one place (the import map) - not copy-pasted across files.

- [ ] **Step 3: Write a failing e2e test for sign-in**

Create `tests/e2e/auth.spec.js`:

```js
import { test, expect } from "@playwright/test";
import { mintCustomToken } from "../support/admin.js";

// Real Google Sign-In popups can't be reliably automated in a headless
// browser (Google's bot detection blocks them) - tests sign in via a
// service-account-minted custom token instead (tests/support/admin.js,
// Task 1), Firebase's own documented pattern for testing Auth-gated apps
// without emulators. A tiny debug page at
// tests/e2e/fixtures/auth-harness.html exposes signInWithToken() to
// Playwright via a global. The real "click Sign in with Google, see a
// popup" interaction is verified manually once (see this plan's Final
// Verification), never by this automated suite.
test("signing in with a custom token exposes the user's email via getCurrentUser()", async ({
  page,
}) => {
  const token = await mintCustomToken("hod@example.com");
  await page.goto("/tests/e2e/fixtures/auth-harness.html?test=1");
  await page.evaluate((t) => window.__signInWithToken(t), token);
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
  <head>
    <script type="importmap">
      {
        "imports": {
          "firebase/app": "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js",
          "firebase/auth": "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js",
          "firebase/firestore": "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"
        }
      }
    </script>
  </head>
  <body>
    <span id="current-email"></span>
    <script type="module">
      import { onAuthChange, signInWithToken } from "../../../src/auth.js";

      onAuthChange((user) => {
        document.getElementById("current-email").textContent = user
          ? user.email
          : "";
      });
      window.__signInWithToken = signInWithToken;
    </script>
  </body>
</html>
```

(Every Firebase-importing bare specifier used anywhere in this plan is mapped here, even though this fixture only directly needs `firebase/auth`/`firebase/app` - `src/auth.js` itself only pulls in those two, so the `firebase/firestore` entry is harmless but unused in this particular fixture. Copy this exact import map into every other standalone test fixture HTML file this plan creates - Task 4's `store-harness.html` - so each resolves independently of `index.html`.)

- [ ] **Step 5: Run it to verify it fails**

Run: `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npx playwright test tests/e2e/auth.spec.js` (needs `npx http-server -p 8080 -c-1 &` running first, per `playwright.config.js`'s existing `webServer` config)
Expected: FAIL before `src/auth.js`/`src/firebase-config.js` exist (module not found), or the sign-in never resolves if those files aren't yet in place.

- [ ] **Step 6: Confirm it passes with the files from Steps 1-2 in place**

Run: `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npx playwright test tests/e2e/auth.spec.js`
Expected: PASS - `#current-email` shows `hod@example.com`.

- [ ] **Step 7: Commit**

```bash
git add src/firebase-config.js src/auth.js tests/e2e/auth.spec.js tests/e2e/fixtures/auth-harness.html
git commit -m "feat: add Google Sign-In via Firebase Auth, with custom-token sign-in for tests"
```

---

### Task 4: Firestore-backed store with overwrite guard

**Files:**

- Modify: `src/ui/store.js` (full rewrite of the persistence internals; public shape changes - see Interfaces)
- Test: `tests/e2e/store.spec.js`
- Test: `tests/e2e/fixtures/store-harness.html`

**Interfaces:**

- Consumes: `app` and `getCurrentUser` from `src/auth.js` (Task 3).
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
import { mintCustomToken } from "../support/admin.js";

test("setData writes to Firestore and a second page load sees it", async ({
  page,
  context,
}) => {
  const token = await mintCustomToken("hod@example.com");
  await page.goto("/index.html?test=1");
  await signInAsHod(page, token);
  await page.click('[data-tab="subjects"]');
  await page.click("#btn-add-subject");
  await page.fill(
    '#table-subjects tbody tr:last-child input[data-field="name"]',
    "Test Subject",
  );

  const page2 = await context.newPage();
  await page2.goto("/index.html?test=1");
  await signInAsHod(page2, token);
  await expect(
    page2.locator(
      '#table-subjects tbody tr:last-child input[data-field="name"]',
    ),
  ).toHaveValue("Test Subject", { timeout: 10000 });
});

test("a stale write is blocked with a plain-language conflict message", async ({
  context,
}) => {
  const token = await mintCustomToken("hod@example.com");
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  await pageA.goto("/index.html?test=1");
  await pageB.goto("/index.html?test=1");
  await signInAsHod(pageA, token);
  await signInAsHod(pageB, token);

  // Both load the same starting state, then A saves first.
  await pageA.click('[data-tab="subjects"]');
  await pageA.click("#btn-add-subject");
  await expect(pageA.locator("#subjects-status")).not.toContainText("Saving");

  // B, still holding the pre-A state, now also writes.
  await pageB.click('[data-tab="subjects"]');
  await pageB.click("#btn-add-subject");

  await expect(pageB.locator("#save-status")).toContainText(
    "updated this since you opened it",
    { timeout: 10000 },
  );
});

// Signs in via a pre-minted custom token through the test-only
// window.__signInWithToken hook (src/ui.js, Task 7 - exposed only when
// useTestProject is true) instead of clicking the real Google Sign-In
// button, which would open a popup no automated browser can reliably
// drive. See tests/e2e/auth.spec.js for the equivalent narrower test.
async function signInAsHod(page, token) {
  await page.waitForFunction(
    () => typeof window.__signInWithToken === "function",
  );
  await page.evaluate((t) => window.__signInWithToken(t), token);
  await expect(page.locator("#app-shell")).toBeVisible({ timeout: 10000 });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npx http-server -p 8080 -c-1 &` then `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npx playwright test tests/e2e/store.spec.js`
Expected: FAIL - `store.js` still reads/writes localStorage, `#save-status`/`#app-shell`/`window.__signInWithToken` don't exist yet (those land in Tasks 6-7).

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
} from "firebase/firestore";
import { app, getCurrentUser } from "../auth.js";

const db = getFirestore(app);

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
  <head>
    <script type="importmap">
      {
        "imports": {
          "firebase/app": "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js",
          "firebase/auth": "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js",
          "firebase/firestore": "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"
        }
      }
    </script>
  </head>
  <body>
    <button id="load">Load</button>
    <button id="save">Save</button>
    <pre id="data-out"></pre>
    <span id="status-out"></span>
    <script type="module">
      import { signInWithToken } from "../../../src/auth.js";
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

      window.__signInWithToken = signInWithToken;

      document.getElementById("load").addEventListener("click", async () => {
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
  const token = await mintCustomToken("hod@example.com");
  await page.goto("/tests/e2e/fixtures/store-harness.html?test=1");
  await page.evaluate((t) => window.__signInWithToken(t), token);
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

Run: `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npx http-server -p 8080 -c-1 &` then `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npx playwright test tests/e2e/store.spec.js -g "initStore"`
Expected: FAIL before `store.js` is rewritten (Step 3) - confirm this ran RED before Step 3's code existed by checking it fails now for the right reason (`initStore is not a function` or similar), then re-run after Step 3's rewrite.
Expected after Step 3: PASS. Stop the background static-file-server process afterward.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store.js tests/e2e/store.spec.js tests/e2e/fixtures/store-harness.html
git commit -m "feat: rewrite store.js to sync through Firestore with an overwrite guard"
```

---

### Task 5: Versions as a Firestore subcollection

**Files:**

- Modify: `src/versions.js` (signature changes - see Interfaces)
- Move: `tests/unit/versions.test.js` → `tests/integration/versions.test.js` (needs a real Firestore connection now - moves out of the fast/offline `tests/unit/` suite, matching this project's "test the real thing" philosophy already used for the HiGHS solver, just against the real test project instead of a mock)

**Interfaces:**

- Consumes: `getFirestoreDb()` from `src/ui/store.js` (Task 4); `mintCustomToken` from `tests/support/admin.js` (Task 1, test-only).
- Produces (Task 7 imports these; signatures changed from the pre-Firestore version):
  - `saveVersion(db, name, assignments, layerSettings, timestamp?)` - `async`, returns the new version's Firestore doc id (`string`).
  - `listVersions(db, currentAssignments)` - `async`, returns `{id, name, timestamp, changedCount}[]`, newest first. `changedCount` is `compareAssignments(version.assignments, currentAssignments).length`, computed once per version so the UI doesn't need a second round trip per row.
  - `restoreVersion(db, data, versionId)` - `async`, returns a new data object with `assignments`/`layerSettings` replaced from the named version; throws if `versionId` doesn't exist.
  - `compareAssignments(fromAssignments, toAssignments)` - **unchanged**, still pure, still synchronous.

- [ ] **Step 1: Write the failing tests**

Move `tests/unit/versions.test.js` to `tests/integration/versions.test.js` (read the existing file first for its current test names/style, then adapt each case to the new async signatures using a real connection to the test project):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import {
  saveVersion,
  listVersions,
  restoreVersion,
  compareAssignments,
} from "../../src/versions.js";
import { mintCustomToken } from "../support/admin.js";
import { testFirebaseConfig } from "./test-firebase-config.js";

const app = initializeApp(testFirebaseConfig, "versions-test");
const db = getFirestore(app);

test.before(async () => {
  const token = await mintCustomToken("hod@example.com");
  await signInWithCustomToken(getAuth(app), token);
});

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

Run: `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json node --test tests/integration/versions.test.js`
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

import { collection, addDoc, getDocs, doc, getDoc } from "firebase/firestore";

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

Run: `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json node --test tests/integration/versions.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git rm tests/unit/versions.test.js
git add src/versions.js tests/integration/versions.test.js
git commit -m "feat: move saved versions into a Firestore subcollection"
```

---

### Task 6: Sign-in screen and save-status UI (`index.html`)

**Files:**

- Modify: `index.html:1-7` (add an import map to `<head>`, before any module script), `index.html:457-471` (wrap the existing `<header>` in `#app-shell`, add `#sign-in-screen`), and `index.html:700` (close the new wrapper - no `<script>` tag changes beyond that, since `src/ui.js` and everything it imports resolve Firebase through the import map, not a `<script>` tag of their own)

**Interfaces:**

- Consumes: the pinned Firebase version confirmed in Task 1 Step 1.
- Produces (element ids Task 7 depends on): `#sign-in-screen`, `#sign-in-button`, `#app-shell`, `#save-status`, `#current-user-email`, `#sign-out-button`. Also produces the import map every Firebase-importing file (`src/auth.js`, `src/ui/store.js`, `src/versions.js`) relies on when loaded through `index.html` (their Node-side tests resolve the same bare specifiers through `node_modules/firebase` instead - no import map needed there).

- [ ] **Step 1: Add the import map**

Add to `index.html`'s `<head>`, before the closing `</head>` tag (it must appear before any `<script type="module">` that uses it - there can be only one `<script type="importmap">` per document):

```html
<script type="importmap">
  {
    "imports": {
      "firebase/app": "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js",
      "firebase/auth": "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js",
      "firebase/firestore": "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"
    }
  }
</script>
```

(Match the `10.14.1` to whatever `npm view firebase version` actually printed in Task 1 Step 1.)

- [ ] **Step 2: Add the sign-in screen and wrap the app shell**

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

- [ ] **Step 3: Close the new `#app-shell` wrapper**

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

- [ ] **Step 4: Add CSS for the sign-in screen and save-status indicator**

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

- [ ] **Step 5: Verify the new markup itself renders correctly**

By this point in the plan, `src/ui/store.js` (Task 4) has already dropped its old `isDirty`/`clearDirty` exports, but `src/ui.js` still imports them (Task 7 hasn't updated it yet) - so `<script type="module" src="src/ui.js">` is EXPECTED to fail to link with a `SyntaxError` mentioning `isDirty` is not exported by `./ui/store.js`. That failure is a known, intentional intermediate state between Tasks 4 and 7, not a defect in this task's markup - this step checks the markup itself renders correctly despite it, by disabling that one script tag temporarily rather than asserting a misleadingly-empty error list.

Run: `npx http-server -p 8080 -c-1 &` then:

```bash
node -e "
import('playwright').then(async ({ chromium }) => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('data:text/html,' + encodeURIComponent(
    require('fs').readFileSync('index.html', 'utf8')
      .replace('<script type=\"module\" src=\"src/ui.js\"></script>', '')
  ));
  console.log('sign-in visible:', await page.locator('#sign-in-screen').isVisible());
  console.log('app-shell hidden:', await page.locator('#app-shell').isHidden());
  await browser.close();
});
"
```

Expected: `sign-in visible: true`, `app-shell hidden: true` - confirming the markup/CSS from Steps 1-4 is structurally correct, independent of `ui.js`'s currently-broken import (which Task 7 resolves).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add sign-in screen and save-status indicator markup"
```

---

### Task 7: Auth-gated boot, async Versions tab, updated onSolve()

**Files:**

- Modify: `src/ui.js` (boot sequence, Versions tab wiring, `onSolve()`)

**Interfaces:**

- Consumes: `onAuthChange`, `signInWithGoogle`, `signOutUser` (Task 3 - `getCurrentUser` is NOT imported here; `onAuthChange`'s callback already receives the user object directly, so `ui.js` never needs to call it separately); `initStore`, `getData`, `setData`, `onChange`, `onSaveStatusChange`, `getFirestoreDb` (Task 4 - `isBlocked` is NOT imported here either; the blocked state is already fully conveyed through `onSaveStatusChange`'s `'blocked'`/`'conflict'` status, which this task's `renderSaveStatus` already renders, so a separate `isBlocked()` check would be redundant); `saveVersion`, `listVersions`, `restoreVersion`, `compareAssignments` (Task 5, new signatures); the element ids from Task 6.
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
  getFirestoreDb,
} from "./ui/store.js";
import {
  onAuthChange,
  signInWithGoogle,
  signInWithToken,
  signOutUser,
} from "./auth.js";
import { useTestProject } from "./firebase-config.js";
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

  // Test-only escape hatch: a real Google popup can't be reliably automated
  // in a headless browser, so the e2e suite signs in via a service-account-
  // minted custom token instead (tests/support/admin.js) when running
  // against the separate test project. Guarded behind useTestProject so it
  // never exists when a real HOD opens the real production app.
  if (useTestProject) {
    window.__signInWithToken = signInWithToken;
  }

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
export FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json
npx http-server -p 8080 -c-1 &
sleep 1
npx playwright test tests/e2e/store.spec.js tests/e2e/auth.spec.js
```

Expected: PASS, all tests from Tasks 3 and 4's e2e specs now fully green (Task 4's `store.spec.js` was left red at the end of Task 4 specifically because it needed this task's sign-in UI/wiring, plus the `window.__signInWithToken` hook this task's boot sequence adds). Stop the background static-file-server process afterward.

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

### Task 9: Point e2e tests at the real test project; add the Review Focus tests

**Files:**

- Modify: `playwright.config.js` (no structural change needed - still a single `webServer` running the static file server; just documents the new env-var requirement)
- Modify: `tests/e2e/deployment.spec.js` (add a sign-in step to every existing flow; add 2 new tests)

**Interfaces:**

- Consumes: everything from Tasks 1-8; `mintCustomToken` from `tests/support/admin.js` (Task 1).
- Produces: nothing (final integration task before docs).

- [ ] **Step 1: Document the env-var requirement in `playwright.config.js`**

`playwright.config.js` needs no structural change (still one `webServer` entry for the static file server - there's no emulator to start alongside it). Add a short comment above the `webServer` block noting the new prerequisite:

```js
old_string:
  webServer: {
    command: "npx http-server -p 8080 -c-1 --silent",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
  },
```

```js
new_string:
  // Tests that sign in (most of this suite) also need FIREBASE_TEST_SERVICE_ACCOUNT
  // set in the environment before running `npx playwright test` - see
  // tests/support/admin.js and docs/superpowers/plans/2026-09-29-firestore-sync.md
  // Task 1's prerequisite note. No emulator process is started here; tests
  // run against the real, separate test Firebase project.
  webServer: {
    command: "npx http-server -p 8080 -c-1 --silent",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
  },
```

- [ ] **Step 2: Add a shared sign-in helper and use it in every existing test**

Read `tests/e2e/deployment.spec.js` fully first (it already has a pattern for shared setup, per its existing structure) and add near the top, alongside any existing helpers:

```js
import { mintCustomToken } from "../support/admin.js";

async function signInAsHod(page) {
  const token = await mintCustomToken("hod@example.com");
  await page.goto("/index.html?test=1");
  await page.waitForFunction(
    () => typeof window.__signInWithToken === "function",
  );
  await page.evaluate((t) => window.__signInWithToken(t), token);
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
  // firebase-admin can mint a token for ANY email, allowlisted or not -
  // rules enforcement happens at the Firestore layer regardless of how
  // sign-in happened, so this genuinely tests the same rejection path a
  // real non-allowlisted Google account would hit.
  const token = await mintCustomToken("stranger@example.com");
  await page.goto("/index.html?test=1");
  await page.waitForFunction(
    () => typeof window.__signInWithToken === "function",
  );
  await page.evaluate((t) => window.__signInWithToken(t), token);
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

Run: `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npx playwright test -g "not on the allowlist|never triggers a re-solve"`
Expected: both the behaviors under test were already built in Tasks 4 and 7 (the transaction's rejection surfaces through `initStore()`'s existing catch block; the reload path already re-fetches from Firestore with no solver call) - so these tests are expected to PASS immediately, confirming those two Review Focus items as real, working regression guards rather than untested claims. If either fails, that's a genuine gap in Tasks 4/7 - use systematic debugging to find and fix it there (not by weakening the test).

- [ ] **Step 6: Confirm the whole suite passes**

Run: `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npx playwright test`
Expected: PASS, every test in `tests/e2e/deployment.spec.js`, `tests/e2e/auth.spec.js`, and `tests/e2e/store.spec.js`.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.js tests/e2e/deployment.spec.js
git commit -m "test: run e2e suite against the real test Firebase project; add allowlist and reload-never-resolves regression tests"
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

1. Run `npm test` (the `tests/unit/**` glob) - expect all tests passing, 0 failures, no network access needed - this stays exactly as fast/offline as before this plan.
2. Run `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npm run test:integration` - expect all rules-test and versions-test cases passing against the real test Firebase project.
3. Run `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npx http-server -p 8080 -c-1 &`, then `FIREBASE_TEST_SERVICE_ACCOUNT=/path/to/your/downloaded-key.json npx playwright test` - expect every e2e test passing (deployment flows + auth + store + the two new Review Focus tests). Stop the background process.
4. Manually (the user, not an agent): create a real PRODUCTION Firebase project (separate from the test project used throughout this plan), replace `src/firebase-config.js`'s `productionConfig` placeholders and `firestore.rules`'s two placeholder emails with real values, paste the rules into that project's Firebase console, and open the deployed GitHub Pages URL without `?test=1` to confirm real Google Sign-In and Firestore work end-to-end against production. This step needs the user's own Google account emails and cannot be scripted by an agent.
