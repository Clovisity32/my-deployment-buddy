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
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
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
