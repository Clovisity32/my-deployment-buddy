import { test, expect } from "@playwright/test";

async function readStoredData(page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("deploymentBuddy.v2") || "null"),
  );
}

/** Mirrors src/data.js's effectiveCap() without importing an ES module into the test. */
function effectiveCap(data, teacher) {
  const role = (data.roles || []).find((r) => r.id === teacher.roleId);
  return teacher.capOverride ?? (role ? role.maxPeriods : null);
}

async function loadSample(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
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
    // still blank here. Clicking Generate with nothing entered is therefore
    // a deterministic no-op - generateClasses() leaves any level with no
    // count untouched - which is enough to confirm regeneration doesn't crash.
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
    // wiring, not just localStorage). Sheet layout should show real teacher
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
    // solve ran automatically.
    const before = await readStoredData(page);
    await page.reload();
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

    // The pre-solve snapshot should have been saved automatically.
    await page.click('nav.tabs button[data-tab="versions"]');
    await expect(page.locator("#versions-list li")).toContainText([
      "Auto-save before solve",
    ]);
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

  test("exporting to Excel and re-importing restores the deployment without re-solving", async ({
    page,
  }) => {
    await loadSample(page);
    await solve(page);
    const before = await readStoredData(page);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#btn-export"),
    ]);
    expect(download.suggestedFilename()).toBe("deployment.xlsx");
    const downloadPath = await download.path(); // Playwright already saved it to a temp location.

    // Start from a clean slate, as if this were a different browser at school.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    expect(await readStoredData(page)).toBeNull();

    await page.click("#btn-import");
    await page.setInputFiles("#file-input", downloadPath);

    // Give the import a moment; then confirm no solve ran (status area stays
    // empty) and the restored deployment matches exactly.
    await expect(page.locator("#table-teachers tbody tr")).toHaveCount(
      before.teachers.length,
    );
    await expect(page.locator("#solve-status")).toBeEmpty();

    const after = await readStoredData(page);
    const key = (d) =>
      new Set(d.assignments.map((a) => `${a.teacherId}|${a.groupId}`));
    expect(key(after)).toEqual(key(before));
    expect(after.versions.length).toBe(before.versions.length);
  });
});
