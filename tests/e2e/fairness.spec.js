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

test.describe("Fairness - Teachers tab", () => {
  test("HOD and SH/ST roles default to fill-to-cap, and the box saves", async ({
    page,
  }) => {
    await loadSample(page);
    await page.click('nav.tabs button[data-tab="teachers"]');
    const hod = page.locator(
      '#table-roles tbody tr[data-id="hod"] [data-field="fillToCap"]',
    );
    const teacher = page.locator(
      '#table-roles tbody tr[data-id="teacher"] [data-field="fillToCap"]',
    );
    await expect(hod).toBeChecked();
    await expect(
      page.locator(
        '#table-roles tbody tr[data-id="sh_st"] [data-field="fillToCap"]',
      ),
    ).toBeChecked();
    await expect(teacher).not.toBeChecked();
    await hod.uncheck();
    await teacher.check();
    const data = await readStoredData(page);
    expect(data.roles.find((r) => r.id === "hod").fillToCap).toBe(false);
    expect(data.roles.find((r) => r.id === "teacher").fillToCap).toBe(true);
  });

  test("a typed Target classes saves, and blank clears it", async ({
    page,
  }) => {
    await loadSample(page);
    await page.click('nav.tabs button[data-tab="teachers"]');
    const row = page.locator('#table-teachers tbody tr[data-id="t1"]');
    const box = row.locator('[data-field="targetClasses"]');
    await box.fill("4");
    expect(
      (await readStoredData(page)).teachers.find((t) => t.id === "t1")
        .targetClasses,
    ).toBe(4);
    await box.fill("");
    expect(
      (await readStoredData(page)).teachers.find((t) => t.id === "t1")
        .targetClasses,
    ).toBeNull();
  });
});

test.describe("Fairness - Solve tab", () => {
  const openSolve = async (page) => {
    await page.click('nav.tabs button[data-tab="layers"]');
    await expect(page.locator("#fairness")).toBeVisible();
  };

  test("a preset button saves the preset and marks it selected", async ({
    page,
  }) => {
    await loadSample(page);
    await openSolve(page);
    await expect(
      page.locator('#fairness [data-preset="classCountFirst"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await page.click('#fairness [data-preset="balanced"]');
    await expect(
      page.locator('#fairness [data-preset="balanced"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('#fairness [data-role="fairness-status"]'),
    ).toContainText("Balanced");
    const f = (await readStoredData(page)).settings.fairness;
    expect(f.preset).toBe("balanced");
  });

  test("moving a slider switches to Custom and saves the levels", async ({
    page,
  }) => {
    await loadSample(page);
    await openSolve(page);
    await page.click("#fairness summary"); // sliders live in the Advanced details
    await page.locator('#fairness [data-key="preps"]').fill("5");
    const f = (await readStoredData(page)).settings.fairness;
    expect(f.preset).toBe("custom");
    expect(f.levels.preps).toBe(5);
    await expect(
      page.locator('#fairness [data-role="fairness-status"]'),
    ).toContainText("Custom");
  });

  test("the Layers list shows no weight box for the fairness layers", async ({
    page,
  }) => {
    await loadSample(page);
    await openSolve(page);
    for (const id of [
      "classCount",
      "mix",
      "preps",
      "graduatingSpread",
      "placeholder",
    ]) {
      const card = page.locator(`#layers-list [data-layer-id="${id}"]`);
      await expect(card.locator(".weight-field")).toHaveCount(0);
      if (id === "placeholder") {
        await expect(card).toContainText("Always kept above");
      } else {
        await expect(card).toContainText("Fairness emphasis");
      }
    }
  });

  test("Solve reports what it gave up", async ({ page }) => {
    await loadSample(page);
    await openSolve(page);
    await page.click("#btn-solve");
    await expect(page.locator("#solve-status")).toContainText("Solved", {
      timeout: 60000,
    });
    await expect(page.locator("#solve-status")).toContainText("Class count:");
    await expect(page.locator("#solve-status")).toContainText("Preps:");
  });
});
