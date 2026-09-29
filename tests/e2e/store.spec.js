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
  await expect(pageA.locator("#save-status")).not.toContainText("Saving");

  // B, still holding the pre-A state, now also writes.
  await pageB.click('[data-tab="subjects"]');
  await pageB.click("#btn-add-subject");

  await expect(pageB.locator("#save-status")).toContainText(
    "updated this since you opened it",
    { timeout: 10000 },
  );
});

async function signInAsHod(page, email = "hod@example.com") {
  // Drives the Auth emulator's real IDP Login Widget popup - it is not
  // auto-accepted. See Task 3's auth.spec.js comment for how this was
  // verified against the running emulator.
  const popupPromise = page.context().waitForEvent("page");
  await page.click("#sign-in-button");
  const popup = await popupPromise;
  await popup.waitForLoadState();
  const existing = popup.locator(`.js-reuse-account:has-text("${email}")`);
  if ((await existing.count()) > 0) {
    await existing.first().click();
  } else {
    await popup.click("#add-account-button");
    await popup.fill("#email-input", email);
    await popup.click("#sign-in");
  }
  await expect(page.locator("#app-shell")).toBeVisible({ timeout: 10000 });
}

test("initStore() loads the current doc and setData() writes it back with a 'saved' status", async ({
  page,
}) => {
  await page.goto("/tests/e2e/fixtures/store-harness.html?emulators=1");
  // #load triggers signInWithGoogle() directly, which opens the Auth
  // emulator's real IDP Login Widget popup - it is not auto-accepted (see
  // Task 3's auth.spec.js comment for how this was verified).
  const popupPromise = page.context().waitForEvent("page");
  await page.click("#load");
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
  await expect(page.locator("#data-out")).not.toHaveText("", {
    timeout: 10000,
  });
  await page.click("#save");
  await expect(page.locator("#status-out")).toHaveText("saved", {
    timeout: 10000,
  });
});
