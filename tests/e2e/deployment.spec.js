import { test, expect } from "@playwright/test";

/**
 * Drives the Auth emulator's real IDP Login Widget popup - it is not
 * auto-accepted. See Task 3's auth.spec.js comment for how this was
 * verified against the running emulator.
 */
async function signInAsHod(page, email = "hod@example.com") {
  await page.goto("/index.html?emulators=1");
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

/**
 * Reads the app's live in-memory data straight from src/ui/store.js's
 * getData() - localStorage.getItem("deploymentBuddy.v2") no longer exists
 * (Firestore is now the source of truth, see Task 8). Dynamic-importing the
 * same module URL index.html already loaded returns the exact same
 * singleton the UI reads/writes, so this reflects the app's state
 * immediately (getData() is updated synchronously, before the Firestore
 * write even resolves - see store.js's setData()).
 */
async function readStoredData(page) {
  return page.evaluate(async () => {
    const { getData } = await import("/src/ui/store.js");
    return getData();
  });
}

/** Mirrors src/data.js's effectiveCap() without importing an ES module into the test. */
function effectiveCap(data, teacher) {
  const role = (data.roles || []).find((r) => r.id === teacher.roleId);
  return teacher.capOverride ?? (role ? role.maxPeriods : null);
}

async function loadSample(page) {
  // Firestore (deployments/main) is now the single shared backing store for
  // every client, including every test in this file and every earlier
  // test/task run against this same long-lived emulator this session -
  // localStorage.clear() no longer isolates a test from leftover data.
  // Wiping the emulator's documents first restores that isolation, and
  // matters beyond tidiness: src/ui/classes.js's "No. of classes" inputs are
  // prefilled from whatever initStore() fetched, once, at boot - stale
  // classes left over from a previous test would silently feed the next
  // test's "Generate classes" click.
  await fetch(
    "http://127.0.0.1:8081/emulator/v1/projects/demo-my-deployment-buddy/databases/(default)/documents",
    { method: "DELETE" },
  );
  await signInAsHod(page);
  await page.click("#btn-load-sample");
  await expect(page.locator("#table-teachers tbody tr")).toHaveCount(10);
}

async function solve(page) {
  await page.click('nav.tabs button[data-tab="layers"]');
  await page.click("#btn-solve");
  // Wait for a TERMINAL status (ok or error) - ".status" alone would also
  // match the transient "Solving…" (info) message and race ahead of the
  // actual async solve.
  await expect(
    page.locator("#solve-status .status.ok, #solve-status .status.error"),
  ).toBeVisible({ timeout: 15000 });
}

test.describe("My Deployment Buddy", () => {
  test("loading the sample school populates every setup tab with real data", async ({
    page,
  }) => {
    await loadSample(page);

    await page.click('nav.tabs button[data-tab="subjects"]');
    await expect(
      page.locator('#table-subjects input[data-field="name"][value="G1 LSS"]'),
    ).toHaveCount(1);

    await page.click('nav.tabs button[data-tab="classes"]');
    await expect(page.locator("#classes-grids")).toContainText(
      "1 Curiosity (101)",
    );

    await page.click('nav.tabs button[data-tab="bands"]');
    await expect(
      page.locator('.band-card input[data-field="name"][value="403 - 405"]'),
    ).toHaveCount(1);

    await page.click('nav.tabs button[data-tab="teachers"]');
    await expect(
      page.locator('#table-teachers input[data-field="name"][value="Amy Lim"]'),
    ).toHaveCount(1);

    await page.click('nav.tabs button[data-tab="groups"]');
    await expect(page.locator("#generated-groups")).toContainText(
      "403 - 405 G3 SCI_PHY Grp 1",
    );
  });

  test("regenerating classes and editing a band's group count updates the Groups tab without solving", async ({
    page,
  }) => {
    await loadSample(page);

    // Classes tab: the per-level "No. of classes" inputs are only pre-filled
    // from data once, at boot (before the sample is loaded), so they're
    // still blank here - loadSample() wipes the emulator's Firestore
    // documents before signing in, so boot has nothing to prefill from.
    // Clicking Generate with nothing entered is therefore a deterministic
    // no-op - generateClasses() leaves any level with no count untouched -
    // which is enough to confirm regeneration doesn't crash.
    await page.click('nav.tabs button[data-tab="classes"]');
    await page.click("#btn-generate-classes");
    await expect(page.locator("#classes-grids")).toContainText(
      "1 Curiosity (101)",
    );

    await page.click('nav.tabs button[data-tab="groups"]');
    await expect(page.locator("#generated-groups")).toContainText(
      "403 - 405 G3 SCI_PHY Grp 3",
    );

    // Bands tab: shrink "403 - 405"'s G3 SCI_PHY from 3 groups down to 2.
    await page.click('nav.tabs button[data-tab="bands"]');
    const bandCard = page.locator('.band-card[data-id="b-403-405"]');
    const subjectRow = bandCard
      .locator("table.band-subjects tbody tr")
      .filter({ has: page.locator('option[value="G3_SCI_PHY"][selected]') });
    await subjectRow.locator('input[data-field="groups"]').fill("2");

    // No "Solve" click anywhere above - the Groups tab reflects the edit
    // immediately via rebuildGroups()/setDataAndRegenerate().
    await page.click('nav.tabs button[data-tab="groups"]');
    await expect(page.locator("#generated-groups")).toContainText(
      "403 - 405 G3 SCI_PHY Grp 2",
    );
    await expect(page.locator("#generated-groups")).not.toContainText(
      "403 - 405 G3 SCI_PHY Grp 3",
    );
  });

  test("solving covers every group, the Deployment View reflects it, and reloading never re-solves", async ({
    page,
  }) => {
    await loadSample(page);
    await solve(page);
    await expect(page.locator("#solve-status .status.ok")).toContainText(
      "Solved",
    );

    const data = await readStoredData(page);
    expect(data).not.toBeNull();

    const neededByGroup = new Map(
      data.groups.map((g) => [g.id, g.teachersNeeded]),
    );
    const countByGroup = new Map();
    for (const a of data.assignments)
      countByGroup.set(a.groupId, (countByGroup.get(a.groupId) || 0) + 1);
    for (const [groupId, needed] of neededByGroup) {
      expect(countByGroup.get(groupId) || 0, `group ${groupId} coverage`).toBe(
        needed,
      );
    }

    const groupById = new Map(data.groups.map((g) => [g.id, g]));
    const loadByTeacher = new Map();
    for (const a of data.assignments) {
      loadByTeacher.set(
        a.teacherId,
        (loadByTeacher.get(a.teacherId) || 0) +
          groupById.get(a.groupId).periods,
      );
    }
    for (const t of data.teachers) {
      const cap = effectiveCap(data, t);
      if (cap == null) continue; // "Others" role with no cap: flagged as a setup warning, not solver-enforced.
      expect(
        loadByTeacher.get(t.id) || 0,
        `${t.name} load vs cap`,
      ).toBeLessThanOrEqual(cap);
    }

    // Spot-check the Deployment View actually reflects the solve (UI
    // wiring, not just the store). Sheet layout should show real teacher
    // names in at least one seat, not blank/undefined.
    await page.click('nav.tabs button[data-tab="deployment"]');
    const printNames = await page
      .locator(".seat .print-name")
      .evaluateAll((els) => els.map((el) => el.textContent.trim()));
    expect(printNames.length).toBeGreaterThan(0);
    expect(
      printNames.some((n) => n && n !== "(none)" && n !== "undefined"),
    ).toBe(true);

    // By-teacher view renders too.
    await page.click('[data-action="view-teacher"]');
    await expect(page.locator("#deployment-body")).toContainText("Amy Lim");
    await expect(page.locator("#deployment-body table thead")).toContainText(
      "Load",
    );

    // Toggle back to Sheet layout.
    await page.click('[data-action="view-sheet"]');
    await expect(page.locator(".deployment-block").first()).toBeVisible();

    // Re-opening never re-solves: reload and confirm nothing changed and no
    // solve ran automatically. Auth persists across reload (Firebase's
    // default IndexedDB persistence), so this lands straight back in
    // #app-shell without a fresh sign-in.
    const before = await readStoredData(page);
    await page.reload();
    await expect(page.locator("#app-shell")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#solve-status")).toBeEmpty();

    const after = await readStoredData(page);
    const key = (d) =>
      new Set(d.assignments.map((a) => `${a.teacherId}|${a.groupId}`));
    expect(key(after)).toEqual(key(before));

    await page.click('nav.tabs button[data-tab="deployment"]');
    const printNamesAfter = await page
      .locator(".seat .print-name")
      .evaluateAll((els) => els.map((el) => el.textContent.trim()));
    expect(printNamesAfter).toEqual(printNames);
  });

  test("changing a teacher's role clears their stale capOverride", async ({
    page,
  }) => {
    await loadSample(page);

    await page.click('nav.tabs button[data-tab="teachers"]');
    // Irfan Salleh (t9) starts on "Others" with capOverride: 20 in the sample.
    const row = page.locator('#table-teachers tr[data-id="t9"]');
    await expect(row.locator('input[data-field="capOverride"]')).toHaveValue(
      "20",
    );

    await row.locator('select[data-field="roleId"]').selectOption("teacher");

    const data = await readStoredData(page);
    const t9 = data.teachers.find((t) => t.id === "t9");
    expect(t9.roleId).toBe("teacher");
    expect(t9.capOverride).toBeFalsy();
  });

  test("deleting a band that drops assignments shows a status message on the Bands tab", async ({
    page,
  }) => {
    await loadSample(page);
    await solve(page);

    await page.click('nav.tabs button[data-tab="bands"]');
    const bandCard = page.locator('.band-card[data-id="b-403-405"]');
    await expect(bandCard).toBeVisible();
    await bandCard.locator('button[data-action="delete-band"]').click();

    await expect(page.locator("#bands-status")).toContainText(
      "assignment(s) were removed because their group no longer exists",
    );
  });

  test("typing a band name keystroke-by-keystroke doesn't lose focus after each character", async ({
    page,
  }) => {
    await loadSample(page);

    await page.click('nav.tabs button[data-tab="bands"]');
    const nameInput = page.locator(
      '.band-card[data-id="b-403-405"] input[data-field="name"]',
    );
    await nameInput.click();
    await nameInput.fill("");
    // pressSequentially dispatches one real keystroke (and one "input"
    // event) at a time - unlike fill(), which sets the whole value in one
    // event - so it reproduces the reported bug: setData() on every
    // keystroke re-renders the Bands tab's innerHTML, destroying and
    // recreating this very input, which drops focus after the first
    // character unless it's explicitly restored.
    await nameInput.pressSequentially("Test Band", { delay: 20 });

    await expect(nameInput).toHaveValue("Test Band");
    await expect(nameInput).toBeFocused();
  });

  test("locking an assignment keeps it fixed across a re-solve", async ({
    page,
  }) => {
    await loadSample(page);
    await solve(page);

    await page.click('nav.tabs button[data-tab="deployment"]');
    const lockCheckbox = page
      .locator('input[data-action="toggle-lock"]')
      .first();
    const select = page.locator('select[data-action="reassign"]').first();
    const lockedTeacherId = await select.inputValue();
    await lockCheckbox.check();
    await expect(lockCheckbox).toBeChecked();

    await solve(page);

    await page.click('nav.tabs button[data-tab="deployment"]');
    const selectAfter = page.locator('select[data-action="reassign"]').first();
    const lockCheckboxAfter = page
      .locator('input[data-action="toggle-lock"]')
      .first();
    await expect(selectAfter).toHaveValue(lockedTeacherId);
    await expect(lockCheckboxAfter).toBeChecked();

    // The pre-solve snapshot should have been saved automatically. Versions
    // now render asynchronously off a Firestore subcollection fetch (Task
    // 5), hence the generous timeout.
    await page.click('nav.tabs button[data-tab="versions"]');
    await expect(page.locator("#versions-list li")).toContainText(
      ["Auto-save before solve"],
      { timeout: 10000 },
    );
  });

  test("solving twice in a row gives the same assignments (deterministic)", async ({
    page,
  }) => {
    await loadSample(page);
    await solve(page);
    const first = await readStoredData(page);
    await solve(page);
    const second = await readStoredData(page);

    const key = (d) =>
      new Set(d.assignments.map((a) => `${a.teacherId}|${a.groupId}`));
    expect(key(second)).toEqual(key(first));
  });

  test("restoring a version brings back the whole setup, and Delete version removes it", async ({
    page,
  }) => {
    await loadSample(page);
    await solve(page);
    const original = await readStoredData(page);
    const originalName = original.teachers[0].name;

    await page.click('nav.tabs button[data-tab="versions"]');
    await page.fill("#version-name", "Snap A");
    await page.click("#btn-save-version");
    const snapRow = page.locator("#versions-list li", { hasText: "Snap A" });
    await expect(snapRow).toContainText("full setup", { timeout: 10000 });

    // Edit the setup (not just assignments) after the snapshot.
    await page.evaluate(async () => {
      const { getData, setData } = await import("/src/ui/store.js");
      const d = getData();
      await setData({
        ...d,
        teachers: d.teachers.map((t, i) =>
          i === 0 ? { ...t, name: "Renamed After Snapshot" } : t,
        ),
      });
    });
    expect((await readStoredData(page)).teachers[0].name).toBe(
      "Renamed After Snapshot",
    );

    page.once("dialog", (d) => d.accept());
    await snapRow.locator('button[data-action="restore-version"]').click();
    await expect(page.locator("#versions-status .status.ok")).toContainText(
      "Restored",
      { timeout: 10000 },
    );
    expect((await readStoredData(page)).teachers[0].name).toBe(originalName);
    await expect(
      page.locator("#versions-list li", {
        hasText: "Auto-save before restore",
      }),
    ).toHaveCount(1);

    page.once("dialog", (d) => d.accept());
    await snapRow.locator('button[data-action="delete-version"]').click();
    await expect(page.locator("#versions-status .status.ok")).toContainText(
      "Deleted",
      { timeout: 10000 },
    );
    await expect(
      page.locator("#versions-list li", { hasText: "Snap A" }),
    ).toHaveCount(0);
  });

  test("exporting to Excel and re-importing restores the deployment without re-solving", async ({
    page,
  }) => {
    await loadSample(page);
    await solve(page);
    const before = await readStoredData(page);

    // Versions now live in a Firestore subcollection, not in `data.versions`
    // (always an empty array on the main doc regardless - see data.js's
    // emptyData()), so a real "import doesn't touch versions" check has to
    // go through the Versions tab list, not the main doc's data.
    await page.click('nav.tabs button[data-tab="versions"]');
    const versionCountBefore = await page.locator("#versions-list li").count();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#btn-export"),
    ]);
    expect(download.suggestedFilename()).toBe("deployment.xlsx");
    const downloadPath = await download.path(); // Playwright already saved it to a temp location.

    // Firestore is the shared source of truth now - there's no client-side
    // "clean slate" to reload into (localStorage.clear() went away with
    // localStorage itself, Task 8). Instead, mutate the current data first
    // so re-importing the exported file is a genuine round-trip check (proof
    // that import actually overwrites the current state), not a no-op
    // comparison against data nothing ever touched.
    await page.click('nav.tabs button[data-tab="subjects"]');
    await page.click("#btn-add-subject");
    await expect(page.locator("#save-status")).toHaveText("Saved", {
      timeout: 10000,
    });
    const changed = await readStoredData(page);
    expect(changed.subjects.length).toBe(before.subjects.length + 1);

    // #solve-status still shows the "Solved" message from the solve() call
    // above (nothing resets it without a reload, unlike the old
    // localStorage.clear()+reload flow) - capture it so the post-import
    // check below proves import didn't trigger a *new* solve, rather than
    // asserting emptiness that was never true to begin with.
    const solveStatusBeforeImport = await page
      .locator("#solve-status")
      .textContent();

    await page.click("#btn-import");
    await page.setInputFiles("#file-input", downloadPath);

    // Give the import a moment; then confirm no solve ran (the status area
    // is untouched, still showing the earlier solve's message, not
    // "Solving…" or a fresh result) and the restored deployment matches
    // exactly.
    await expect(page.locator("#table-teachers tbody tr")).toHaveCount(
      before.teachers.length,
    );
    await expect(page.locator("#solve-status")).toHaveText(
      solveStatusBeforeImport,
    );

    const after = await readStoredData(page);
    const key = (d) =>
      new Set(d.assignments.map((a) => `${a.teacherId}|${a.groupId}`));
    expect(key(after)).toEqual(key(before));
    expect(after.subjects.length).toBe(before.subjects.length);

    await page.click('nav.tabs button[data-tab="versions"]');
    await expect(page.locator("#versions-list li")).toHaveCount(
      versionCountBefore,
    );
  });

  test("signing in with an email not on the allowlist is rejected with a clear message, not a blank app", async ({
    page,
  }) => {
    // hod@example.com and cohod@example.com are the only allowlisted emails
    // (firestore.rules) - sign in as a third, non-allowlisted identity via
    // the same widget flow signInAsHod() drives, by passing a different email.
    await signInAsHod(page, "someone-else@example.com");
    // Signed in (Auth doesn't restrict by email), but Firestore denies every
    // read/write for this identity - initStore() must surface that as a
    // message, not a silent blank page.
    await expect(page.locator("body")).toContainText(
      /could not load the deployment/i,
      { timeout: 10000 },
    );
  });

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
});
