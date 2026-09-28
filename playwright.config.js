import { defineConfig } from "@playwright/test";

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
