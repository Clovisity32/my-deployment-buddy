import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Small local suite; keep it simple and deterministic.
  // Every spec file now shares the same Firestore emulator doc
  // (deployments/main) - unlike the old localStorage-backed tests, which
  // were isolated per browser context, a second worker running a different
  // spec file concurrently can race a write into the same doc and trip the
  // overwrite guard (Task 8's "someone else updated this" conflict). One
  // worker keeps the suite deterministic now that state is shared.
  workers: 1,
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
