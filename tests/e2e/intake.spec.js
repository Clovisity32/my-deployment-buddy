import { test, expect } from "@playwright/test";

// --- helpers copied from board.spec.js (each spec file is self-contained) ---
async function signInAsHod(page, email = "hod@example.com") {
  for (let attempt = 1; attempt <= 3; attempt++) {
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

async function readStoredData(page) {
  return page.evaluate(async () => {
    const { getData } = await import("/src/ui/store.js");
    return getData();
  });
}

async function writeStoredData(page, mutate) {
  await page.evaluate(async (src) => {
    const { getData, setData } = await import("/src/ui/store.js");
    const fn = new Function("data", `return (${src})(data);`);
    await setData(fn(getData()));
  }, mutate.toString());
}

async function loadSample(page) {
  await fetch(
    "http://127.0.0.1:8081/emulator/v1/projects/demo-my-deployment-buddy/databases/(default)/documents",
    { method: "DELETE" },
  );
  await signInAsHod(page);
  await page.click("#btn-load-sample");
  await expect(page.locator("#table-teachers tbody tr")).toHaveCount(10);
}

async function openBoard(page) {
  await page.click('nav.tabs button[data-tab="board"]');
  await expect(page.locator("#board-body .board-card").first()).toBeVisible();
}
// ---------------------------------------------------------------------------

async function openTeachers(page) {
  await page.click('nav.tabs button[data-tab="teachers"]');
  await expect(page.locator("#intake")).toBeVisible();
}
const card = (page, kind) =>
  page.locator(`#intake .intake-card[data-kind="${kind}"]`);

test.describe("Intake", () => {
  test("pasting form teachers shows a preview, then saves them", async ({
    page,
  }) => {
    await loadSample(page);
    await openTeachers(page);
    const c = card(page, "formTeachers");
    await c
      .locator('[data-role="intake-paste"]')
      .fill("Class\tForm teacher\r\n102\tAmy Lim\r\n201\tBen Ong\r\n");
    await c.locator('[data-action="intake-preview"]').click();
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "2 row(s) ready",
    );
    await c.locator('[data-action="intake-save"]').click();
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "Saved",
    );
    const data = await readStoredData(page);
    expect(data.classes.find((x) => x.id === "102").formTeacherId).toBe("t1");
    expect(data.classes.find((x) => x.id === "201").formTeacherId).toBe("t2");
  });

  test("a row that does not match is explained and Save stays disabled", async ({
    page,
  }) => {
    await loadSample(page);
    await openTeachers(page);
    const c = card(page, "formTeachers");
    await c
      .locator('[data-role="intake-paste"]')
      .fill("999\tAmy Lim\n102\tNobody Here");
    await c.locator('[data-action="intake-preview"]').click();
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "Row 2",
    );
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "No class matches",
    );
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "No teacher matches",
    );
    await expect(c.locator('[data-action="intake-save"]')).toBeDisabled();
  });

  test("the template downloads as an Excel file", async ({ page }) => {
    await loadSample(page);
    await openTeachers(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      card(page, "denies").locator('[data-action="intake-template"]').click(),
    ]);
    expect(download.suggestedFilename()).toBe("deny-list-template.xlsx");
  });

  test("an uploaded filled file is read, previewed and saved", async ({
    page,
  }) => {
    await loadSample(page);
    await openTeachers(page);
    const bytes = await page.evaluate(() => {
      const X = window.XLSX;
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(
        wb,
        X.utils.aoa_to_sheet([
          ["Teacher", "Level", "Stream", "Subject"],
          ["Ben Ong", 1, "G2", ""],
        ]),
        "Template",
      );
      return Array.from(
        new Uint8Array(X.write(wb, { type: "array", bookType: "xlsx" })),
      );
    });
    const c = card(page, "denies");
    await c.locator('[data-role="intake-file"]').setInputFiles({
      name: "denies.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(bytes),
    });
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "1 row(s) ready",
    );
    await c.locator('[data-action="intake-save"]').click();
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "Saved",
    );
    const data = await readStoredData(page);
    expect(data.teachers.find((t) => t.id === "t2").denies).toEqual([
      { level: 1, stream: "G2" },
    ]);
  });

  test("editing the pasted rows after a preview disables Save", async ({
    page,
  }) => {
    await loadSample(page);
    await openTeachers(page);
    const c = card(page, "formTeachers");
    await c.locator('[data-role="intake-paste"]').fill("102	Amy Lim");
    await c.locator('[data-action="intake-preview"]').click();
    await expect(c.locator('[data-action="intake-save"]')).toBeEnabled();
    await c.locator('[data-role="intake-paste"]').fill("102	Ben Ong");
    await expect(c.locator('[data-action="intake-save"]')).toBeDisabled();
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "Check pasted rows",
    );
  });

  test("saving another list in between does not revert it", async ({
    page,
  }) => {
    await loadSample(page);
    await openTeachers(page);
    const f = card(page, "formTeachers");
    await f.locator('[data-role="intake-paste"]').fill("102	Amy Lim");
    await f.locator('[data-action="intake-preview"]').click();
    await expect(f.locator('[data-action="intake-save"]')).toBeEnabled();
    const d = card(page, "denies");
    await d.locator('[data-role="intake-paste"]').fill("Ben Ong	1	G2	");
    await d.locator('[data-action="intake-preview"]').click();
    await d.locator('[data-action="intake-save"]').click();
    await expect(d.locator('[data-role="intake-preview"]')).toContainText(
      "Saved",
    );
    await f.locator('[data-action="intake-save"]').click();
    await expect(f.locator('[data-role="intake-preview"]')).toContainText(
      "Saved",
    );
    const data = await readStoredData(page);
    expect(data.teachers.find((t) => t.id === "t2").denies).toEqual([
      { level: 1, stream: "G2" },
    ]);
    expect(data.classes.find((x) => x.id === "102").formTeacherId).toBe("t1");
  });

  test("an unreadable file after a valid preview disables Save", async ({
    page,
  }) => {
    await loadSample(page);
    await openTeachers(page);
    const c = card(page, "formTeachers");
    await c.locator('[data-role="intake-paste"]').fill("102	Amy Lim");
    await c.locator('[data-action="intake-preview"]').click();
    await expect(c.locator('[data-action="intake-save"]')).toBeEnabled();
    await c.locator('[data-role="intake-file"]').setInputFiles({
      name: "bad.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("PK\x03\x04not a spreadsheet", "latin1"),
    });
    await expect(c.locator('[data-role="intake-preview"]')).toContainText(
      "Could not read that file",
    );
    await expect(c.locator('[data-action="intake-save"]')).toBeDisabled();
  });
});

test("Apply continuity locks last year's teacher on the Board and reports what it skipped", async ({
  page,
}) => {
  await loadSample(page);
  await writeStoredData(page, (d) => ({
    ...d,
    lastYear: [
      { level: 1, classRef: "101", subjectId: "G1_LSS", teacherId: "t1" }, // -> Sec 2 G1 LSS group
      { level: 1, classRef: "199", subjectId: "G1_LSS", teacherId: "t1" }, // no such class
    ],
  }));
  await openBoard(page);
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Lock 1 placement");
    dialog.accept();
  });
  await page.click('[data-action="apply-continuity"]');
  await expect(page.locator("#board-toast")).toContainText(
    "Locked 1 placement",
  );
  await expect(page.locator("#board-continuity-report")).toContainText(
    "no Sec 2 class matches",
  );
  const data = await readStoredData(page);
  expect(data.assignments).toContainEqual({
    teacherId: "t1",
    groupId: "g_G1_LSS_b-2",
    locked: true,
  });
});

test("Apply continuity with nothing loaded says what to do next", async ({
  page,
}) => {
  await loadSample(page);
  await writeStoredData(page, (d) => ({ ...d, lastYear: [] }));
  await openBoard(page);
  await page.click('[data-action="apply-continuity"]');
  await expect(page.locator("#board-toast")).toContainText(
    "Last year's teachers",
  );
});

test("a team-taught group is marked on the Board", async ({ page }) => {
  await loadSample(page);
  await writeStoredData(page, (d) => ({
    ...d,
    groups: d.groups.map((g) =>
      g.id === "g_G1_LSS_b-2" ? { ...g, teachersNeeded: 2 } : g,
    ),
  }));
  await openBoard(page);
  await expect(
    page.locator('[data-group-id="g_G1_LSS_b-2"] .team-badge'),
  ).toBeVisible();
  await expect(
    page.locator('[data-group-id="g_G2_LSS_b-2"] .team-badge'),
  ).toHaveCount(0);
});
