import { test, expect } from "@playwright/test";

test("setData writes to Firestore and a second page load sees it", async ({
  page,
  context,
}) => {
  await page.goto("/index.html?emulators=1");
  await signInAsHod(page);
  await page.click('[data-tab="subjects"]');
  await page.click("#btn-add-subject");
  // Isolate the add-subject write from the name-fill write below: wait for
  // it to settle first, so the next "Saved" we observe can't be a stale
  // leftover from THIS write instead of the one that actually carries
  // "Test Subject".
  await expect(page.locator("#save-status")).toHaveText("Saved", {
    timeout: 10000,
  });

  await page.fill(
    '#table-subjects tbody tr:last-child input[data-field="name"]',
    "Test Subject",
  );
  // setData() writes to Firestore in the background (fire-and-forget) and
  // initStore() is a one-shot fetch, not a realtime listener - this app is
  // "latest on open", not live-synced (see the design spec). A second
  // client only sees this edit once it opens AFTER the write is confirmed
  // durable. Status text alone can't distinguish "Saved" from this write
  // vs. the add-subject write above (both render the same static string),
  // so require the full Saving...->Saved transition, proving THIS write's
  // cycle was observed, not a leftover from the previous one.
  await expect(page.locator("#save-status")).toHaveText("Saving…", {
    timeout: 10000,
  });
  await expect(page.locator("#save-status")).toHaveText("Saved", {
    timeout: 10000,
  });

  const page2 = await context.newPage();
  await page2.goto("/index.html?emulators=1");
  // No sign-in here: page2 shares this context's persisted Firebase auth
  // session, so the sign-in button is hidden and the app boots signed in.
  await page2.click('[data-tab="subjects"]');
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
  //
  // The widget occasionally never submits (popup stays open, no request
  // sent, a second click does nothing); a fresh popup works, so retry up to 3
  // times. The caller has already loaded the page, so only reload on a retry.
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await page.goto("/index.html?emulators=1");
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
    try {
      await expect(page.locator("#app-shell")).toBeVisible({
        timeout: attempt < 3 ? 4000 : 10000,
      });
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      await popup.close().catch(() => {});
    }
  }
}

// #load triggers signInWithGoogle() directly, which opens the Auth
// emulator's real IDP Login Widget popup - it is not auto-accepted (see
// Task 3's auth.spec.js comment for how this was verified).
async function loadHarnessAndSignIn(page, email = "hod@example.com") {
  // Retry with a fresh popup if the emulator's login widget never submits
  // (see signInAsHod above).
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto("/tests/e2e/fixtures/store-harness.html?emulators=1");
    const popupPromise = page.context().waitForEvent("page");
    await page.click("#load");
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
    try {
      await expect(page.locator("#data-out")).not.toHaveText("", {
        timeout: attempt < 3 ? 4000 : 10000,
      });
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      await popup.close().catch(() => {});
    }
  }
}

test("initStore() loads the current doc and setData() writes it back with a 'saved' status", async ({
  page,
}) => {
  await loadHarnessAndSignIn(page);
  await page.click("#save");
  await expect(page.locator("#status-out")).toHaveText("saved", {
    timeout: 10000,
  });
});

test("two rapid same-session setData() calls, neither awaited before the next fires, don't lose the later edit or falsely conflict", async ({
  page,
}) => {
  await loadHarnessAndSignIn(page);

  await page.click("#save-twice");
  // Must settle on "saved", never get stuck on "blocked" or "conflict" -
  // both writes came from the same session, so there is nothing to
  // conflict with.
  await expect(page.locator("#status-out")).toHaveText("saved", {
    timeout: 10000,
  });

  // The later edit ("Second") must be what's actually persisted - not
  // silently dropped in favour of the earlier one. Re-fetch from Firestore
  // (bypassing the in-memory cache) rather than opening a second signed-in
  // page, to prove durability without a second, unrelated sign-in flow.
  await page.click("#reload");
  await expect(page.locator("#data-out")).toContainText("Second", {
    timeout: 10000,
  });
  const persisted = JSON.parse(await page.locator("#data-out").textContent());
  expect(persisted.roles[0].name).toBe("Second");

  // The session must not have been left permanently blocked by the rapid
  // pair - a normal save afterwards still succeeds.
  await page.click("#save");
  await expect(page.locator("#status-out")).toHaveText("saved", {
    timeout: 10000,
  });
});

test("two clients both starting from a not-yet-created doc: the second save is blocked, not silently merged", async ({
  context,
}) => {
  // Guarantee deployments/main does not exist yet, regardless of what
  // earlier tests in this run created - the Firestore emulator's clear-data
  // endpoint wipes every document for this project. This is the exact race
  // the conflict guard must catch: two clients that both loaded when there
  // was no doc yet (loadedUpdatedAt === null on both) must still conflict
  // once one of them has created it.
  await fetch(
    "http://127.0.0.1:8081/emulator/v1/projects/demo-my-deployment-buddy/databases/(default)/documents",
    { method: "DELETE" },
  );

  const pageA = await context.newPage();
  const pageB = await context.newPage();
  await loadHarnessAndSignIn(pageA);
  await loadHarnessAndSignIn(pageB);

  await pageA.click("#save");
  await expect(pageA.locator("#status-out")).toHaveText("saved", {
    timeout: 10000,
  });

  // B still holds loadedUpdatedAt = null, but the doc now exists (created
  // by A) - this must be treated as a conflict, not silently overwritten.
  await pageB.click("#save");
  await expect(pageB.locator("#status-out")).toContainText("conflict", {
    timeout: 10000,
  });
});
