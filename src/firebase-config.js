// Firebase project config. These values are public client identifiers, not
// secrets - safe to commit. Access is protected by firestore.rules, not by
// hiding these. See
// docs/superpowers/specs/2026-09-29-firestore-sync-design.md "Auth & access
// control".

// Opt into the local emulator suite via a query param, e.g.
// index.html?emulators=1 - no build step, no env vars, works identically
// whether the file is opened locally or served from GitHub Pages.
const useEmulators =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("emulators");

// projectId must stay "demo-my-deployment-buddy" in emulator mode - it's
// the id every test helper and npm script (firebase.json/.firebaserc,
// `firebase emulators:exec --project demo-my-deployment-buddy`, the e2e
// suite's own clear-data fetch() calls) hardcodes to scope the local
// emulator's in-memory data. Using the real project id there would point
// the app at a different, empty data namespace inside the same emulator
// process and break every test that seeds/clears data by that id.
const firebaseConfig = useEmulators
  ? {
      apiKey: "demo-api-key",
      authDomain: "demo-my-deployment-buddy.firebaseapp.com",
      projectId: "demo-my-deployment-buddy",
    }
  : {
      apiKey: "AIzaSyBjSEcAw5DPZTN5607bizbOHI-lZDgvKWE",
      authDomain: "mydeploymentbuddy.firebaseapp.com",
      projectId: "mydeploymentbuddy",
      storageBucket: "mydeploymentbuddy.firebasestorage.app",
      messagingSenderId: "994115696333",
      appId: "1:994115696333:web:8837068c275cd62db55b84",
    };

export { firebaseConfig, useEmulators };
