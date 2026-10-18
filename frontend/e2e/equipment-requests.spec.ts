import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:5001";
const EVENT = "11111111-1111-4111-8111-111111111111";
const FIRST = "22222222-2222-4222-8222-222222222222";
const SECOND = "33333333-3333-4333-8333-333333333333";
const event = { id: EVENT, title: "Community workshop", event_datetime: "2026-10-18T06:00:00Z" };
const equipment = [
  { id: FIRST, equipment_type: "Wireless microphone", location: "AV store", operational_status: "Operational" },
  { id: SECOND, equipment_type: "Projector", location: "Level 2", operational_status: "Operational" },
];
const saved = {
  id: "44444444-4444-4444-8444-444444444444", event_id: EVENT, event,
  status: "Requested", routed_to: "Tech Support", requested_by: 2,
  requested_at: "2026-10-14T06:00:00Z", requester: { display_name: "Demo Coordinator" },
  items: equipment.map((item, index) => ({
    equipment_id: item.id, equipment_type: item.equipment_type, location: item.location,
    position: index + 1, quantity: index + 1, technical_notes: index ? "HDMI input" : "Spare batteries",
  })),
};

async function session(page: Page, role: string | null = "Coordinator") {
  await page.route(API + "/session", route => route.fulfill({ json: { user: role ? { id: 2, role } : null } }));
}

async function options(page: Page) {
  // An option on page 2 must be available, not silently omitted from the form.
  await page.route(API + "/equipment?*", route => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get("page"));
    return route.fulfill({ json: { equipment: [equipment[pageNumber - 1]], has_more: pageNumber === 1 } });
  });
  await page.route(API + "/equipment/requests/events?*", route => route.fulfill({ json: { events: [event], has_more: false } }));
}

test("Coordinator submits two items; Tech Support sees saved notes, routing and audit", async ({ page }, testInfo) => {
  await session(page);
  await options(page);
  let writes = 0;
  await page.route(API + "/equipment/requests", async route => {
    writes++;
    expect(route.request().postDataJSON()).toEqual({ event_id: EVENT, items: [
      { equipment_id: FIRST, quantity: 1, technical_notes: "Spare batteries" },
      { equipment_id: SECOND, quantity: 2, technical_notes: "HDMI input" },
    ] });
    await route.fulfill({ status: 201, json: { request: saved } });
  });
  await page.route(API + "/equipment/requests?*", route => route.fulfill({ json: { requests: [saved], has_more: false } }));
  await page.goto("/");
  await page.getByRole("link", { name: "Request equipment", exact: true }).click();
  await page.getByLabel("Event", { exact: true }).selectOption(EVENT);
  await page.getByLabel("Equipment 1", { exact: true }).selectOption(FIRST);
  await page.getByLabel("Technical notes 1", { exact: false }).fill("Spare batteries");
  await page.getByRole("button", { name: "Add another item" }).click();
  await page.getByLabel("Equipment 2", { exact: true }).selectOption(SECOND);
  await page.getByLabel("Quantity 2", { exact: true }).fill("2");
  await page.getByLabel("Technical notes 2", { exact: false }).fill("HDMI input");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach(`request-form-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  }
  await page.getByRole("button", { name: "Submit equipment request" }).click();
  await expect(page.getByRole("heading", { name: "Equipment request submitted" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Requested");
  await page.getByRole("link", { name: "View requests" }).click();
  await expect(page.getByRole("article")).toContainText("Spare batteries");
  await session(page, "Tech Support");
  await page.reload();
  await expect(page.getByRole("article")).toContainText("HDMI input");
  await expect(page.getByRole("article")).toContainText("Requested by Demo Coordinator");
  await expect(page.getByRole("link", { name: "Request equipment", exact: true })).toHaveCount(0);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach(`request-queue-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  }
  expect(writes).toBe(1);
});

for (const quantity of ["0", "-1", "1.5", ""]) {
  test(`invalid quantity ${quantity || "blank"} is retained with an accessible error`, async ({ page }) => {
    await session(page); await options(page);
    await page.route(API + "/equipment/requests", route => {
      expect(route.request().postDataJSON().items[0].quantity).toBe(quantity === "" ? null : Number(quantity));
      return route.fulfill({ status: 400, json: {
        error: "Please check the highlighted fields.", fields: { "items.0.quantity": "Enter a positive whole number." },
      } });
    });
    await page.goto("/equipment/requests/new");
    await page.getByLabel("Quantity 1", { exact: true }).fill(quantity);
    await page.getByRole("button", { name: "Submit equipment request" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
    await expect(page.getByLabel("Quantity 1", { exact: true })).toHaveValue(quantity);
    await expect(page.getByLabel("Quantity 1", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("heading", { name: "Equipment request submitted" })).toHaveCount(0);
  });
}

for (const role of ["Tech Support", "Organiser", "Venue Staff", "Attendee", null]) {
  test(`request form denies ${role ?? "signed out"} before fetching options`, async ({ page }) => {
    await session(page, role);
    let reads = 0;
    await page.route(API + "/equipment**", route => { reads++; return route.abort(); });
    await page.goto("/equipment/requests/new");
    await expect(page.getByRole("status")).toHaveText(role ? "Only Coordinators can request equipment." : "Sign in or select a demo user to continue.");
    expect(reads).toBe(0);
  });
}

test("removing a row preserves other edits and cancel never submits", async ({ page }) => {
  await session(page); await options(page);
  await page.route(API + "/equipment/requests?*", route => route.fulfill({ json: { requests: [], has_more: false } }));
  let writes = 0;
  await page.route(API + "/equipment/requests", route => { writes++; return route.abort(); });
  await page.goto("/equipment/requests/new");
  await page.getByRole("button", { name: "Add another item" }).click();
  await page.getByLabel("Technical notes 2", { exact: false }).fill("Keep this note");
  await page.getByRole("button", { name: "Remove item 1" }).click();
  await expect(page.getByLabel("Technical notes 1", { exact: false })).toHaveValue("Keep this note");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("No equipment requests on this page.")).toBeVisible();
  expect(writes).toBe(0);
});

test("options can be retried; server failure preserves notes and offers request lookup", async ({ page }) => {
  await session(page); await options(page);
  let fail = true;
  await page.route(API + "/equipment/requests/events?*", route => route.fulfill(fail
    ? { status: 503, json: { error: "Could not load Planning events." } }
    : { json: { events: [event], has_more: false } }));
  await page.route(API + "/equipment/requests", route => route.fulfill({ status: 503, json: { error: "Could not confirm submission. Check requests before retrying." } }));
  await page.goto("/equipment/requests/new");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not load");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByLabel("Technical notes 1", { exact: false }).fill("Keep my notes");
  await page.getByRole("button", { name: "Submit equipment request" }).click();
  await expect(page.getByRole("link", { name: "Check requests" })).toBeVisible();
  await expect(page.getByLabel("Technical notes 1", { exact: false })).toHaveValue("Keep my notes");
});
