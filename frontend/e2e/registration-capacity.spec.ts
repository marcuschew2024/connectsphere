import { expect, test, type Page } from "./fixtures";

const EVENT_ID = "41414141-4141-4141-8141-414141414141";
const API = "http://localhost:5001";
const endpoint = `${API}/events/${EVENT_ID}/registration-capacity`;

async function openEvent(page: Page, options: {
  role?: "Organiser" | "Coordinator";
  status?: string;
  capacity?: number | null;
  count?: number;
} = {}) {
  const { role = "Organiser", status = "Planning", capacity = null, count = 0 } = options;
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: role === "Organiser" ? 1 : 2, display_name: `Demo ${role}`, role },
  } }));
  await page.route("**/notifications", (route) => route.fulfill({ json: { notifications: [] } }));
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill({ json: { event: {
    id: EVENT_ID, title: "Campus workshop", description: "Learn together", category: "Workshop",
    organiser_id: 1, coordinator_id: 2, status, request_status: status,
    expected_attendance: 120, registration_capacity: capacity, registered_count: count,
    event_datetime: "2099-10-20T06:00:00Z", updated_at: "2026-10-26T10:00:00Z",
  } } }));
  await page.route(`${API}/events/${EVENT_ID}/history`, (route) => route.fulfill({ json: { history: [] } }));
  await page.route(`${API}/events/${EVENT_ID}/clarification`, (route) => route.fulfill({ json: { clarification: null } }));
  await page.route(`${API}/events/${EVENT_ID}/change-requests`, (route) => route.fulfill({ json: { change_requests: [] } }));
  await page.route(`${API}/venues/bookings/event/${EVENT_ID}`, (route) => route.fulfill({ json: { bookings: [] } }));
  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByRole("heading", { name: "Registration capacity", exact: true })).toBeVisible();
}

test("organiser sets a clear signup limit and sees the persisted summary", async ({ page }, testInfo) => {
  let payload: unknown;
  await page.route(endpoint, async (route) => {
    expect(route.request().method()).toBe("PUT");
    payload = route.request().postDataJSON();
    await route.fulfill({ json: { registration_capacity: {
      capacity: 100, registered_count: 0, remaining: 100, is_full: false,
    } } });
  });
  await openEvent(page);
  const panel = page.getByRole("region", { name: "Registration capacity" });
  await expect(panel.getByText("Registration stays closed until a capacity is set.")).toBeVisible();
  await expect(panel.getByText(/Expected attendance is a planning estimate/)).toBeVisible();
  await page.getByLabel("Maximum attendees").fill("100");
  await page.getByRole("button", { name: "Save capacity" }).click();
  await expect(panel.getByRole("status")).toContainText("Capacity saved");
  expect(payload).toEqual({ capacity: 100 });
  await expect(panel.getByText("100 places remaining", { exact: true })).toBeVisible();
  await expect(panel.getByText("0 registered of 100 places")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("capacity-desktop.png"), fullPage: true });
});

test("invalid capacity stays in the form with an accessible correction", async ({ page }) => {
  let writes = 0;
  await page.route(endpoint, () => { writes++; });
  await openEvent(page);
  const input = page.getByLabel("Maximum attendees");
  for (const value of ["", "0", "1.5", "10001", "2147483648"]) {
    await input.fill(value);
    await page.getByRole("button", { name: "Save capacity" }).click();
    await expect(page.getByRole("region", { name: "Registration capacity" }).getByRole("alert"))
      .toHaveText("Enter a whole number between 1 and 10,000.");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-invalid", "true");
  }
  expect(writes).toBe(0);
});

test("failed save preserves the previous limit and the entered value", async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({ status: 503,
    json: { error: "Could not confirm the capacity change. Refresh before retrying." },
  }));
  await openEvent(page, { capacity: 20 });
  await page.getByLabel("Maximum attendees").fill("100");
  await page.getByRole("button", { name: "Save capacity" }).click();
  await expect(page.getByRole("region", { name: "Registration capacity" }).getByRole("alert"))
    .toContainText("Could not confirm");
  await expect(page.getByLabel("Maximum attendees")).toHaveValue("100");
  await expect(page.getByText("20 places remaining", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save capacity" })).toBeEnabled();
});

test("confirmed full event explains the limit without offering capacity edits", async ({ page }) => {
  await openEvent(page, { status: "Confirmed", capacity: 100, count: 100 });
  const panel = page.getByRole("region", { name: "Registration capacity" });
  await expect(panel.getByText("Full", { exact: true })).toBeVisible();
  await expect(panel.getByText("This event is full. No places are currently available.")).toBeVisible();
  await expect(panel.getByText(/Capacity is locked after confirmation/)).toBeVisible();
  await expect(page.getByLabel("Maximum attendees")).toHaveCount(0);
});

test("coordinator sees capacity without organiser-only controls", async ({ page }) => {
  await openEvent(page, { role: "Coordinator", capacity: 100, count: 99 });
  const panel = page.getByRole("region", { name: "Registration capacity" });
  await expect(panel.getByText("1 place remaining", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button")).toHaveCount(0);
});

test("capacity form fits a narrow screen and supports keyboard submission", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(endpoint, (route) => route.fulfill({ json: { registration_capacity: {
    capacity: 50, registered_count: 0, remaining: 50, is_full: false,
  } } }));
  await openEvent(page);
  await page.getByLabel("Maximum attendees").fill("50");
  await page.getByLabel("Maximum attendees").press("Enter");
  const panel = page.getByRole("region", { name: "Registration capacity" });
  await expect(panel.getByRole("status")).toContainText("Capacity saved");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath("capacity-mobile.png") });
});


test("organiser can save the maximum capacity of ten thousand", async ({ page }) => {
  await page.route(endpoint, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ capacity: 10000 });
    await route.fulfill({ json: { registration_capacity: {
      capacity: 10000, registered_count: 0, remaining: 10000, is_full: false,
    } } });
  });
  await openEvent(page);
  await expect(page.getByLabel("Maximum attendees")).toHaveAttribute("max", "10000");
  await page.getByLabel("Maximum attendees").fill("10000");
  await page.getByRole("button", { name: "Save capacity" }).click();
  await expect(page.getByRole("region", { name: "Registration capacity" }).getByRole("status"))
    .toContainText("Capacity saved");
  await expect(page.getByText("10,000 places remaining", { exact: true })).toBeVisible();
});
