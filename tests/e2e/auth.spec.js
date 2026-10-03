import { test, expect } from "@playwright/test";

// signInWithPopup(), against the Auth emulator, opens a REAL popup window at
// http://127.0.0.1:9099/emulator/auth/handler - the emulator's own "IDP
// Login Widget". It is NOT auto-accepted; Playwright must catch the popup
// and drive it like a user would: either click an existing account in the
// list (`.js-reuse-account`, shown once that email has signed in before in
// this emulator session) or, the first time, click "Add new account"
// (`#add-account-button`), fill `#email-input`, and submit (`#sign-in`).
// Verified directly against the running emulator (12.19.0) before writing
// this - see the ledger.
test("signing in with an allowed email exposes the user's email via getCurrentUser()", async ({
  page,
}) => {
  // The emulator's login widget occasionally never submits (popup stays open,
  // no request sent); a fresh popup works, so retry the popup flow.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto("/tests/e2e/fixtures/auth-harness.html?emulators=1");
    const popupPromise = page.context().waitForEvent("page");
    await page.click("#trigger-sign-in");
    const popup = await popupPromise;
    await popup.waitForLoadState();
    const existing = popup.locator(
      '.js-reuse-account:has-text("hod@example.com")',
    );
    if ((await existing.count()) > 0) {
      await existing.first().click();
    } else {
      await popup.click("#add-account-button");
      await popup.fill("#email-input", "hod@example.com");
      await popup.click("#sign-in");
    }
    try {
      await expect(page.locator("#current-email")).toHaveText(
        "hod@example.com",
        { timeout: attempt < 3 ? 4000 : 10000 },
      );
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      await popup.close().catch(() => {});
    }
  }
});
