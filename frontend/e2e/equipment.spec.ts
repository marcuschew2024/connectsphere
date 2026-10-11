import { expect, test, type Page, type TestInfo } from "@playwright/test";

const API = "http://localhost:5001";
const ID = "11111111-1111-4111-8111-111111111111";
const initial = {
  id: ID, equipment_type: "Wireless microphone", description: "Handheld with receiver",
  total_quantity: 8, location: "AV store", operational_status: "Operational", usable_quantity: 8,
  created_by: 4, updated_by: 4, created_at: "2026-10-10T06:00:00Z",
  updated_at: "2026-10-10T06:00:00Z", revision: 1,
  creator: { display_name: "Demo Tech Support" }, editor: { display_name: "Demo Tech Support" },
};

async function session(page: Page, role: string | null) {
  await page.route(API + "/session", route => route.fulfill({
    json: { user: role ? { id: 4, role } : null },
  }));
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = await page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
  await testInfo.attach(name, { body: screenshot, contentType: "image/png" });
}

test.beforeEach(async ({ page }) => { await session(page, "Tech Support"); });

test("support creates equipment, sees it in the catalogue, and edits its condition", async ({ page }, testInfo) => {
  let equipment = { ...initial };
  await page.route(API + "/equipment**", route => {
    const method = route.request().method();
    if (method === "POST" || method === "PUT") {
      const body = route.request().postDataJSON();
      expect(Object.keys(body).sort()).toEqual([
        "description", "equipment_type", "location", "operational_status", "total_quantity",
        ...(method === "PUT" ? ["revision"] : []),
      ].sort());
      if (method === "PUT") expect(body.revision).toBe(1);
      equipment = {
        ...equipment, ...body,
        usable_quantity: body.operational_status === "Operational" ? body.total_quantity : 0,
        revision: method === "PUT" ? 2 : 1,
      };
      return route.fulfill({ status: method === "POST" ? 201 : 200, json: { equipment } });
    }
    return route.fulfill({ json: route.request().url().includes(ID)
      ? { equipment } : { equipment: [equipment], page: 1, has_more: false } });
  });
  await page.goto("/");
  await page.getByRole("region", { name: "Quick actions" }).getByRole("link", { name: "Add equipment" }).click();
  await page.getByLabel("Equipment type", { exact: true }).fill(initial.equipment_type);
  await page.getByLabel("Description", { exact: true }).fill(initial.description);
  await page.getByLabel("Location", { exact: true }).fill(initial.location);
  await page.getByLabel("Total quantity", { exact: true }).fill("8");
  await page.getByRole("button", { name: "Save equipment" }).click();
  await expect(page.getByRole("heading", { name: "Equipment added" })).toBeVisible();
  await page.getByRole("link", { name: "View catalogue" }).click();
  await expect(page.getByRole("article")).toContainText("8");
  await page.getByRole("link", { name: "Edit Wireless microphone at AV store" }).click();
  await expect(page.getByLabel("Total quantity", { exact: true })).toHaveValue("8");
  await page.getByLabel("Operational status", { exact: true }).click();
  await page.getByRole("option", { name: "Under Maintenance" }).click();
  await page.getByLabel("Description", { exact: true }).fill("Receiver being serviced");
  await capture(page, testInfo, "equipment-edit-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, testInfo, "equipment-edit-mobile.png");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Equipment updated" })).toBeVisible();
  await expect(page.getByText("Wireless microphone has 0 usable units out of 8 total.", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "View catalogue" }).click();
  await expect(page.getByRole("article")).toContainText("Excluded from usable stock");
  await expect(page.getByRole("article")).toContainText("Updated by Demo Tech Support");
  await capture(page, testInfo, "equipment-catalogue-mobile.png");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await capture(page, testInfo, "equipment-catalogue-desktop.png");
  await page.reload();
  await expect(page.getByRole("article")).toContainText("Under Maintenance");
});

test("coordinator can browse and filter usable stock with no editing controls", async ({ page }) => {
  await session(page, "Coordinator");
  const requests: string[] = [];
  await page.route(API + "/equipment?*", route => {
    requests.push(route.request().url());
    const filtered = route.request().url().includes("operational_only=true");
    return route.fulfill({ json: { equipment: filtered ? [] : [initial], page: 1, has_more: false } });
  });
  await page.goto("/equipment");
  await expect(page.getByRole("article")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add equipment", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Edit Wireless/ })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Show usable stock only" }).check();
  await expect(page.getByText("No usable stock on this page")).toBeVisible();
  expect(requests.at(-1)).toContain("page=1&operational_only=true");
});

for (const role of ["Coordinator", "Organiser", "Venue Staff", "Attendee", null]) {
  test(`create and edit are denied for ${role ?? "no session"}`, async ({ page }) => {
    await session(page, role);
    let reads = 0;
    await page.route(API + "/equipment**", route => { reads++; return route.fulfill({ json: { equipment: initial } }); });
    for (const path of ["/equipment/new", `/equipment/${ID}/edit`]) {
      await page.goto(path);
      await expect(page.getByText(role ? "Only Tech Support can maintain equipment." : "Sign in or select a demo user to continue.")).toBeVisible();
      await expect(page.getByRole("textbox")).toHaveCount(0);
    }
    expect(reads).toBe(0);
  });
}

for (const status of [400, 409, 503]) {
  test(`failed save (${status}) preserves edits and shows recovery`, async ({ page }) => {
    await page.route(API + `/equipment/${ID}`, route => route.request().method() === "PUT"
      ? route.fulfill({ status, json: {
        error: status === 409 ? "Another staff member updated this equipment. Reload it and reapply your changes." : "Please check the equipment details.",
        fields: status === 400 ? { total_quantity: "Enter a whole number from 0 to 2147483647." } : {},
      } })
      : route.fulfill({ json: { equipment: initial } }));
    await page.goto(`/equipment/${ID}/edit`);
    await page.getByLabel("Total quantity", { exact: true }).fill("-1");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
    await expect(page.getByLabel("Total quantity", { exact: true })).toHaveValue("-1");
    await expect(page.getByRole("heading", { name: "Equipment updated" })).toHaveCount(0);
    if (status === 400) await expect(page.getByLabel("Total quantity", { exact: true })).toHaveAttribute("aria-invalid", "true");
    if (status === 409) await expect(page.getByRole("button", { name: "Reload latest version" })).toBeVisible();
    if (status === 503) await expect(page.getByRole("link", { name: "Check catalogue" })).toBeVisible();
  });
}

test("blank quantity is sent as missing, never silently converted to zero", async ({ page }) => {
  await page.route(API + "/equipment", route => {
    expect(route.request().postDataJSON().total_quantity).toBeNull();
    return route.fulfill({ status: 400, json: {
      error: "Please check the highlighted fields.", fields: { total_quantity: "Enter a whole number." },
    } });
  });
  await page.goto("/equipment/new");
  await page.getByRole("button", { name: "Save equipment" }).click();
  await expect(page.getByLabel("Total quantity", { exact: true })).toHaveAttribute("aria-invalid", "true");
});

test("pagination and filter reset the page, and load errors can be retried", async ({ page }) => {
  let fail = true;
  await page.route(API + "/equipment?*", route => {
    if (fail) return route.fulfill({ status: 503, json: { error: "Could not load equipment." } });
    const current = Number(new URL(route.request().url()).searchParams.get("page"));
    return route.fulfill({ json: { equipment: [initial], page: current, has_more: current === 1 } });
  });
  await page.goto("/equipment");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not load equipment.");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("article")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Show usable stock only" }).check();
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
});

test("cancel does not write and missing equipment shows a useful error", async ({ page }) => {
  let writes = 0;
  await page.route(API + `/equipment/${ID}`, route => {
    if (route.request().method() === "PUT") writes++;
    return route.fulfill({ json: { equipment: initial } });
  });
  await page.route(API + "/equipment?*", route => route.fulfill({ json: { equipment: [], page: 1, has_more: false } }));
  await page.goto(`/equipment/${ID}/edit`);
  await page.getByLabel("Description", { exact: true }).fill("Unsaved changes");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Equipment catalogue" })).toBeVisible();
  expect(writes).toBe(0);
  await page.route(API + `/equipment/${ID}`, route => route.fulfill({ status: 404, json: { error: "Equipment not found." } }));
  await page.goto(`/equipment/${ID}/edit`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Equipment not found.");
});
