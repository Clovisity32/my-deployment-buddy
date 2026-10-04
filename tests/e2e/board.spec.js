import { test, expect } from "@playwright/test";

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
  // Tall viewport: Playwright scrolls the page while the mouse is held when a
  // drag source and target are far apart, which cancels the HTML5 drag.
  await page.setViewportSize({ width: 1280, height: 3000 });
  await page.click('nav.tabs button[data-tab="board"]');
  await expect(page.locator("#board-body .board-card").first()).toBeVisible();
}

test.describe("Board", () => {
  test("shows subject cards with rows, seats and a live teacher tally", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    const data = await readStoredData(page);
    await expect(page.locator("#board-body .board-row")).toHaveCount(
      data.groups.length,
    );
    await expect(page.locator("#board-tally .tally-row")).toHaveCount(
      data.teachers.length,
    );
    await expect(page.locator("#board-tally")).toContainText("Amy Lim");
    await expect(page.locator("#board-summary")).toContainText("Demand");
  });

  test("names are consistent and rows inside a card are ordered by stream", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    const names = await page.locator("#board-body .row-name").allTextContents();
    for (const n of names) {
      if (n.startsWith("Enrichment")) continue;
      expect(n).toMatch(/^S\d /);
    }
    const rank = { G1: 1, G2: 2, G3: 3, PURE: 4, "": 5 };
    const cards = page.locator("#board-body .board-card");
    for (let i = 0; i < (await cards.count()); i++) {
      const streams = await cards
        .nth(i)
        .locator(".board-row")
        .evaluateAll((els) => els.map((e) => e.dataset.stream));
      const ranks = streams.map((s) => rank[s] ?? 5);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  test("picking a teacher assigns the seat; an unqualified pick is not offered", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    const data = await readStoredData(page);
    const g = data.groups.find((x) => x.subjectId === "G1_SCI");
    const select = page.locator(
      `.board-row[data-group-id="${g.id}"] select[data-action="reassign"]`,
    );
    const offered = await select
      .locator("option")
      .evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    expect(offered).not.toContain("t1"); // Amy is not qualified for G1_SCI
    await select.selectOption("t2");
    const after = await readStoredData(page);
    expect(
      after.assignments.some((a) => a.groupId === g.id && a.teacherId === "t2"),
    ).toBe(true);
    await expect(
      page.locator('#board-tally .tally-row[data-teacher-id="t2"]'),
    ).toContainText("10 /");
  });

  test("adding a group from a card puts it next to its siblings and freezes the board", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    const card = page.locator("#board-body .board-card").first();
    const before = await card.locator(".board-row").count();
    const level = await card.getAttribute("data-level");
    const select = card.locator('select[data-action="add-group-card"]');
    const subjectId = await select
      .locator("option")
      .nth(1)
      .getAttribute("value");
    await select.selectOption(subjectId);
    await expect(page.locator("#board-toast")).toContainText("Group added");
    await expect(card.locator(".board-row")).toHaveCount(before + 1);
    const data = await readStoredData(page);
    expect(data.groupsFrozen).toBe(true);
    expect(data.groups.at(-1).level).toBe(Number(level));
  });

  test("a group's details can be edited, duplicated, and deleted after a confirmation", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    const row = page.locator("#board-body .board-row").first();
    const id = await row.getAttribute("data-group-id");
    await row.locator('[data-action="toggle-details"]').click();
    await row.locator('input[data-field="periods"]').fill("9");
    await row.locator('input[data-field="periods"]').blur();
    expect(
      (await readStoredData(page)).groups.find((g) => g.id === id).periods,
    ).toBe(9);

    const count = (await readStoredData(page)).groups.length;
    await row.locator('[data-action="duplicate-group"]').click();
    expect((await readStoredData(page)).groups.length).toBe(count + 1);

    page.once("dialog", (d) => d.dismiss());
    await row.locator('[data-action="delete-group"]').click();
    expect((await readStoredData(page)).groups.length).toBe(count + 1);
    page.once("dialog", (d) => d.accept());
    await row.locator('[data-action="delete-group"]').click();
    expect((await readStoredData(page)).groups.length).toBe(count);
  });

  test("changing the big/small cut-off updates the tally", async ({ page }) => {
    await loadSample(page);
    await openBoard(page);
    await page.fill("#board-big-periods", "6");
    await page.locator("#board-big-periods").blur();
    expect((await readStoredData(page)).settings.bigPeriods).toBe(6);
  });

  test("Rebuild groups from setup asks first, and rebuilds when confirmed", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    const original = (await readStoredData(page)).groups.length;
    const row = page.locator("#board-body .board-row").first();
    await row.locator('[data-action="toggle-details"]').click();
    page.once("dialog", (d) => d.accept());
    await row.locator('[data-action="delete-group"]').click();
    expect((await readStoredData(page)).groups.length).toBe(original - 1);

    await page.click('nav.tabs button[data-tab="classes"]');
    let message = "";
    page.once("dialog", (d) => {
      message = d.message();
      d.dismiss();
    });
    await page.click("#btn-rebuild-groups-classes");
    expect(message).toContain("Rebuild groups from setup");
    expect((await readStoredData(page)).groups.length).toBe(original - 1);

    page.once("dialog", (d) => d.accept());
    await page.click("#btn-rebuild-groups-classes");
    expect((await readStoredData(page)).groups.length).toBe(original);
  });

  async function setUpSwap(page) {
    // t1 Amy and t2 Ben are both qualified for G2_LSS. Put one on each of two G2_LSS groups.
    await writeStoredData(page, (d) => {
      const g2 = d.groups.filter((g) => g.subjectId === "G2_LSS").slice(0, 2);
      return {
        ...d,
        assignments: [
          { teacherId: "t1", groupId: g2[0].id, locked: false },
          { teacherId: "t2", groupId: g2[1].id, locked: false },
        ],
      };
    });
    const d = await readStoredData(page);
    const [a, b] = d.groups.filter((g) => g.subjectId === "G2_LSS").slice(0, 2);
    return [a.id, b.id];
  }

  test("dragging a teacher onto another class swaps the two", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    const [a, b] = await setUpSwap(page);
    await page
      .locator(`.board-row[data-group-id="${a}"] .grip`)
      .dragTo(page.locator(`.board-row[data-group-id="${b}"] .seat`));
    const after = await readStoredData(page);
    expect(after.assignments.find((x) => x.groupId === a).teacherId).toBe("t2");
    expect(after.assignments.find((x) => x.groupId === b).teacherId).toBe("t1");
    await expect(page.locator("#board-toast")).toContainText("Swapped");
  });

  test("dropping a class on a teacher in the tally gives it to them; the tray clears it", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    const [a] = await setUpSwap(page);
    await page
      .locator(`.board-row[data-group-id="${a}"] .grip`)
      .dragTo(page.locator('#board-tally .tally-row[data-teacher-id="t2"]'));
    expect(
      (await readStoredData(page)).assignments.find((x) => x.groupId === a)
        .teacherId,
    ).toBe("t2");
    await page
      .locator(`.board-row[data-group-id="${a}"] .grip`)
      .dragTo(page.locator("#board-unassigned"));
    expect(
      (await readStoredData(page)).assignments.some((x) => x.groupId === a),
    ).toBe(false);
  });

  test("an unqualified drop is refused with a plain-language message and nothing changes", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    await writeStoredData(page, (d) => {
      const lss = d.groups.find((g) => g.subjectId === "G2_LSS");
      const sci = d.groups.find((g) => g.subjectId === "G1_SCI");
      return {
        ...d,
        assignments: [
          { teacherId: "t1", groupId: lss.id, locked: false }, // Amy: LSS only
          { teacherId: "t2", groupId: sci.id, locked: false }, // Ben: LSS + G1_SCI
        ],
      };
    });
    const before = await readStoredData(page);
    const sci = before.groups.find((g) => g.subjectId === "G1_SCI");
    const lss = before.groups.find((g) => g.subjectId === "G2_LSS");
    // Swapping would put Amy on G1_SCI, which she is not qualified for.
    await page
      .locator(`.board-row[data-group-id="${sci.id}"] .grip`)
      .dragTo(page.locator(`.board-row[data-group-id="${lss.id}"] .seat`));
    await expect(page.locator("#board-toast")).toContainText("isn't qualified");
    expect((await readStoredData(page)).assignments).toEqual(
      before.assignments,
    );
  });

  test("Undo last change reverses a swap and Redo brings it back", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    const [a, b] = await setUpSwap(page);
    await page
      .locator(`.board-row[data-group-id="${a}"] .grip`)
      .dragTo(page.locator(`.board-row[data-group-id="${b}"] .seat`));
    await page.click('[data-action="undo"]');
    let d = await readStoredData(page);
    expect(d.assignments.find((x) => x.groupId === a).teacherId).toBe("t1");
    await page.click('[data-action="redo"]');
    d = await readStoredData(page);
    expect(d.assignments.find((x) => x.groupId === a).teacherId).toBe("t2");
  });

  test("Ctrl+Z undoes a board change when focus is not in a text box", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    const g = (await readStoredData(page)).groups.find(
      (x) => x.subjectId === "G1_SCI",
    );
    await page
      .locator(
        `.board-row[data-group-id="${g.id}"] select[data-action="reassign"]`,
      )
      .selectOption("t2");
    await page.locator("#panel-board h2").first().click();
    await page.keyboard.press("Control+z");
    expect(
      (await readStoredData(page)).assignments.some((x) => x.groupId === g.id),
    ).toBe(false);
  });

  test("undoing never writes an undefined field and does not touch other tabs' data", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    await page
      .locator("#board-body .board-card")
      .first()
      .locator('select[data-action="add-group-card"]')
      .selectOption({ index: 1 });
    await page.click('[data-action="undo"]');
    const d = await readStoredData(page);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(d.teachers.length).toBe(10);
  });

  test("Solve on the Board fills every seat, and Undo last change reverses the solve", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    await page.click("#btn-solve-board");
    await expect(page.locator("#board-solve-status .status.ok")).toContainText(
      "Solved",
      { timeout: 15000 },
    );
    expect((await readStoredData(page)).assignments.length).toBeGreaterThan(0);
    await page.click('[data-action="undo"]');
    expect((await readStoredData(page)).assignments.length).toBe(0);
  });

  test("Undo cannot reach back across Load sample: nothing to undo, and the data stays valid", async ({
    page,
  }) => {
    await loadSample(page);
    await openBoard(page);
    await page
      .locator("#board-body .board-card")
      .first()
      .locator('select[data-action="add-group-card"]')
      .selectOption({ index: 1 });
    expect((await readStoredData(page)).groupsFrozen).toBe(true);

    await page.click("#btn-load-sample"); // replaces the whole school
    expect((await readStoredData(page)).groupsFrozen).toBeUndefined();
    await page.click('[data-action="undo"]');
    await expect(page.locator("#board-toast")).toContainText("Nothing to undo");
    expect((await readStoredData(page)).groupsFrozen).toBeUndefined();
  });
});
