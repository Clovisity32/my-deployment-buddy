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
