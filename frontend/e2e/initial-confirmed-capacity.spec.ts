import { expect, test, type Page } from "./fixtures";

const API = "http://localhost:5001";
const EVENT_ID = "40404040-4040-4040-8040-404040404040";

async function openEvent(page: Page, options: { role?: string; status?: string; capacity?: number | null } = {}) {
  const { role = "Organiser", status = "Confirmed", capacity = null } = options;
  await page.route("**/session", (route) => route.fulfill({ json: { user: { id: 1, role } } }));
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill({ json: { event: {
    id: EVENT_ID, title: "Confirmed workshop", status, request_status: status,
    organiser_id: 1, coordinator_id: 2, registration_capacity: capacity, registered_count: 0,
    event_datetime: "2099-10-20T06:00:00Z", updated_at: "2026-10-29T06:00:00Z",
  } } }));
  await page.route(`${API}/events/${EVENT_ID}/history`, (route) => route.fulfill({ json: { history: [] } }));
  await page.route(`${API}/events/${EVENT_ID}/clarification`, (route) => route.fulfill({ json: { clarification: null } }));
  await page.route(`${API}/events/${EVENT_ID}/change-requests`, (route) => route.fulfill({ json: { change_requests: [] } }));
  await page.route(`${API}/venues/bookings/event/${EVENT_ID}`, (route) => route.fulfill({ json: { bookings: [] } }));
  await page.goto(`/events/${EVENT_ID}`);
  return page.getByRole("region", { name: "Registration capacity" });
}

test("organiser sets the first capacity on a Confirmed event and it immediately locks", async ({ page }, testInfo) => {
  await page.route(`${API}/events/${EVENT_ID}/registration-capacity`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ capacity: 72 });
    await route.fulfill({ json: { registration_capacity: {
      capacity: 72, registered_count: 0, remaining: 72, is_full: false,
    } } });
  });
  const panel = await openEvent(page);
  await expect(panel.getByText(/Set the first signup limit for this confirmed event/)).toBeVisible();
  await panel.getByLabel("Maximum attendees").fill("72");
  await panel.getByRole("button", { name: "Save capacity", exact: true }).click();
  await expect(panel.getByText("72 places remaining", { exact: true })).toBeVisible();
  await expect(panel.getByRole("status")).toContainText("Capacity saved");
  await expect(panel.getByLabel("Maximum attendees")).toHaveCount(0);
  await expect(panel.getByText(/Capacity is locked after confirmation/)).toBeVisible();
  await expect(page.getByTestId("event-status-badge")).toHaveText("Confirmed");
  await panel.screenshot({ path: testInfo.outputPath("initial-capacity-saved.png") });
});

test("failed initial save retains the empty limit and entered information", async ({ page }) => {
  await page.route(`${API}/events/${EVENT_ID}/registration-capacity`, (route) => route.fulfill({
    status: 503, json: { error: "Could not confirm the capacity change. Refresh before retrying." },
  }));
  const panel = await openEvent(page);
  await panel.getByLabel("Maximum attendees").fill("72");
  await panel.getByRole("button", { name: "Save capacity", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Could not confirm");
  await expect(panel.getByLabel("Maximum attendees")).toHaveValue("72");
  await expect(panel.getByText("Not set", { exact: true })).toBeVisible();
  await expect(panel.getByRole("status")).toHaveCount(0);
});

for (const options of [{ role: "Coordinator" }, { status: "Preparation" }, { capacity: 72 }]) {
  test(`initial setup stays unavailable for ${JSON.stringify(options)}`, async ({ page }) => {
    const panel = await openEvent(page, options);
    await expect(panel.getByLabel("Maximum attendees")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Save capacity", exact: true })).toHaveCount(0);
  });
}
