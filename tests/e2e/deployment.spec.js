import { test, expect } from "@playwright/test";

async function readStoredData(page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("deploymentBuddy.v1") || "null"),
  );
}

async function loadSample(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click("#btn-load-sample");
  await expect(page.locator("#table-teachers tbody tr")).toHaveCount(9);
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
  test("loading the sample school and solving covers every group with no one over cap", async ({
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
      expect(
        loadByTeacher.get(t.id) || 0,
        `${t.name} load vs cap`,
      ).toBeLessThanOrEqual(t.maxPeriods);
    }

    // Spot-check the Deployment View actually reflects the solve (UI wiring, not just localStorage).
    await page.click('nav.tabs button[data-tab="deployment"]');
    await expect(page.locator(".deployment-block select")).toHaveCount(
      data.groups.reduce((s, g) => s + g.teachersNeeded, 0),
    );
  });

  test("a group with no qualified teacher produces a plain-language error, not a crash", async ({
    page,
  }) => {
    await loadSample(page);

    // Make "1G1A SCI" (an LSS group) require a subject nobody teaches. Values
    // live in <input value="..."> attributes, not text nodes, so `hasText`
    // (which matches rendered text content) can't find the row - filter by
    // the label input's value instead.
    await page.click('nav.tabs button[data-tab="groups"]');
    const row = page.locator("#table-groups tbody tr").filter({
      has: page.locator('input[data-field="label"][value="1G1A SCI"]'),
    });
    await row.locator('input[data-field="block"]').fill("Art");

    await solve(page);
    await expect(page.locator("#solve-status .status.error")).toBeVisible();
    await expect(page.locator("#solve-status .status.error")).toContainText(
      "No teacher is qualified",
    );
    await expect(page.locator("#solve-status .status.error")).toContainText(
      "1G1A SCI",
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
    const downloadPath = await download.path(); // Playwright already saved it to a temp location.

    // Start from a clean slate, as if this were a different browser at school.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("#table-teachers tbody tr")).toHaveCount(0);

    await page.click("#btn-import");
    await page.setInputFiles("#file-input", downloadPath);

    // Give the import a moment; then confirm no solve ran (status area stays empty)
    // and the restored deployment matches exactly.
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
