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
  projectId: "demo-my-deployment-buddy",
};

// Opt into the local emulator suite via a query param, e.g.
// index.html?emulators=1 - no build step, no env vars, works identically
// whether the file is opened locally or served from GitHub Pages.
const useEmulators =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("emulators");

export { firebaseConfig, useEmulators };
