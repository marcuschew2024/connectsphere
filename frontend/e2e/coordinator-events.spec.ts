import { expect, test, type Page } from "./fixtures";

const API = "http://localhost:5001";
const EVENT_ID = "40404040-4040-4040-8040-404040404040";
const event = {
  id: EVENT_ID, title: "Workshop ready to confirm", category: "Workshop",
  description: "A campus workshop", purpose: "Learn together", status: "Planning",
  request_status: "Planning", organiser_id: 1, coordinator_id: 2,
  event_datetime: "2099-10-20T06:00:00Z", expected_attendance: 10,
  updated_at: "2026-10-29T06:00:00Z", is_mine: true,
};

async function session(page: Page, role: string | null = "Coordinator") {
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: role ? { id: 2, display_name: `Demo ${role}`, role } : null,
  } }));
}

test("coordinator can reopen a Planning event from Home and confirm it", async ({ page }) => {
  await session(page);
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events: [event] } }));
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill({ json: { event } }));
  await page.route(`${API}/events/${EVENT_ID}/history`, (route) => route.fulfill({ json: { history: [] } }));
  await page.route(`${API}/events/${EVENT_ID}/clarification`, (route) => route.fulfill({ json: { clarification: null } }));
  await page.route(`${API}/events/${EVENT_ID}/change-requests`, (route) => route.fulfill({ json: { change_requests: [] } }));
  await page.route(`${API}/venues/bookings/event/${EVENT_ID}`, (route) => route.fulfill({ json: { bookings: [] } }));
  let confirmations = 0;
  await page.route(`${API}/events/${EVENT_ID}/confirm`, async (route) => {
    expect(route.request().method()).toBe("POST");
    confirmations++;
    await route.fulfill({ json: { event: { ...event, status: "Confirmed", request_status: "Confirmed" } } });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Manage events", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All events", exact: true })).toBeVisible();
  await page.getByRole("region", { name: "Your assigned events" }).getByRole("link", { name: /Workshop ready to confirm/ }).click();
  await expect(page.getByRole("heading", { name: event.title })).toBeVisible();
  await page.getByRole("button", { name: "Confirm event", exact: true }).click();
  await expect(page.getByTestId("event-status-badge")).toHaveText("Confirmed");
  expect(confirmations).toBe(1);
});

test("SCRUM-54: own events are actionable and surfaced first; others are view-only", async ({ page }) => {
  await session(page);
  const theirs = {
    ...event, id: `${EVENT_ID}-other`, title: "Another coordinator's event",
    organiser_id: 1, coordinator_id: 7, is_mine: false,
  };
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events: [event, theirs] } }));
  await page.goto("/events/managed");

  const assigned = page.getByRole("region", { name: "Your assigned events" });
  const otherEvents = page.getByRole("region", { name: "All other events" });
  // Own event is in the first section and is an actionable link.
  await expect(assigned.getByRole("link", { name: /Workshop ready to confirm/ })).toBeVisible();
  // Another coordinator's event is visible for oversight but has no link to open it.
  await expect(otherEvents).toContainText("Another coordinator's event");
  await expect(otherEvents).toContainText("view only");
  await expect(otherEvents.getByRole("link")).toHaveCount(0);
});

test("submitted review queue separates your requests from others", async ({ page }) => {
  await session(page);
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events: [event] } }));
  await page.goto("/events/review");
  await expect(page.getByText("There are no submitted requests assigned to you.")).toBeVisible();
  await page.getByRole("link", { name: "View all events →", exact: true }).click();
  await expect(page.getByRole("region", { name: "Your assigned events" })).toContainText(event.title);
});

test("later lifecycle stages remain reachable for coordinator follow-up", async ({ page }, testInfo) => {
  await session(page);
  await page.route(`${API}/events`, (route) => route.fulfill({ json: {
    events: ["Planning", "Confirmed", "Preparation", "Completed"].map((status) => ({
      ...event, id: `${EVENT_ID}-${status}`, title: `${status} workshop`, status,
    })),
  } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/events/managed");
  const list = page.getByRole("region", { name: "Your assigned events" });
  for (const status of ["Planning", "Confirmed", "Preparation", "Completed"]) {
    await expect(list.getByRole("heading", { name: `${status} workshop`, exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("coordinator-events-mobile.png"), fullPage: true });
});

test("failed load offers retry without claiming the list is empty", async ({ page }) => {
  await session(page);
  let reads = 0;
  await page.route(`${API}/events`, (route) => route.fulfill(++reads === 1
    ? { status: 503, json: { error: "Could not load events." } }
    : { json: { events: [event] } }));
  await page.goto("/events/managed");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Could not load events.");
  await expect(page.getByText("There are no events assigned to you yet.")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("region", { name: "Your assigned events" })).toContainText(event.title);
});

test("an empty list explains that no events are assigned", async ({ page }) => {
  await session(page);
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events: [] } }));
  await page.goto("/events/managed");
  await expect(page.getByText("There are no events assigned to you yet.")).toBeVisible();
});

for (const role of ["Organiser", "Attendee", null]) {
  test(`events page does not fetch Coordinator records for ${role ?? "guests"}`, async ({ page }) => {
    await session(page, role);
    let reads = 0;
    await page.route(`${API}/events`, (route) => { reads++; return route.fulfill({ json: { events: [event] } }); });
    await page.goto("/events/managed");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Only Coordinators can access events here.");
    await expect(page.getByRole("region", { name: "Your assigned events" })).toHaveCount(0);
    expect(reads).toBe(0);
  });
}
