import { expect, test, type Page } from "./fixtures";
import type { BookingRecord } from "../src/lib/bookings";

// SCRUM-126: one event holds several venue bookings, each managed independently. The API
// is mocked; sibling isolation in the database is covered by the API's lifecycle and
// persistence tests. Release v1 audit: this panel had no browser test.
test.use({ timezoneId: "Asia/Singapore" });

const API = "http://localhost:5001";
const EVENT_ID = "12612612-6126-4126-8126-126126126126";

const EVENT = {
  id: EVENT_ID, title: "Multi-space conference", status: "Planning", request_status: "Planning",
  organiser_id: 1, coordinator_id: 2, expected_attendance: 300, updated_at: "2026-10-31T01:00:00Z",
  last_status_changed_at: "2026-10-31T01:00:00Z", last_status_changed_by: 2,
};

function arrangement(id: string, name: string, status: BookingRecord["status"], hour: number): BookingRecord {
  return {
    id, event_id: EVENT_ID, venue_id: `venue-${id}`, status,
    start_at: `2099-10-20T0${hour}:00:00Z`, end_at: `2099-10-20T0${hour + 2}:00:00Z`,
    decision_reason: null, suggested_alternative: null, decided_by: null, decision_at: null,
    requested_by: 2, requested_at: "2026-10-31T00:00:00Z", expected_attendance: 150,
    layout: "Theatre", special_requirements: null,
    venue: { name, location: "Block A" },
  } as BookingRecord;
}

const AUDITORIUM = arrangement("a", "Main auditorium", "Confirmed", 1);
const BREAKOUT = arrangement("b", "Breakout room", "Requested", 4);

async function openEvent(page: Page, role: "Coordinator" | "Organiser" | "Venue Staff", status = "Planning") {
  const state = { cancelled: [] as string[], failCancel: false };
  const id = { Organiser: 1, Coordinator: 2, "Venue Staff": 3 }[role];
  await page.route("**/notifications", (r) => r.fulfill({ json: { notifications: [] } }));
  await page.route("**/session", (r) => r.fulfill({ json: { user: { id, display_name: `Demo ${role}`, role } } }));
  await page.route(`${API}/events/${EVENT_ID}`, (r) => r.fulfill({ json: { event: { ...EVENT, status } } }));
  await page.route(`${API}/events/${EVENT_ID}/history`, (r) => r.fulfill({ json: { history: [] } }));
  await page.route(`${API}/events/${EVENT_ID}/clarification`, (r) => r.fulfill({ json: { clarification: null } }));
  await page.route(`${API}/events/${EVENT_ID}/change-requests`, (r) => r.fulfill({ json: { change_requests: [] } }));
  await page.route(`${API}/venues/bookings/event/${EVENT_ID}`, (r) => r.fulfill({ json: { bookings: [AUDITORIUM, BREAKOUT] } }));
  await page.route(`${API}/venues/bookings/*/cancel`, (r) => {
    const bookingId = r.request().url().split("/").at(-2)!;
    state.cancelled.push(bookingId);
    if (state.failCancel) return r.fulfill({ status: 409, json: { error: "This booking can no longer be cancelled." } });
    const original = bookingId === "a" ? AUDITORIUM : BREAKOUT;
    return r.fulfill({ json: { booking: { ...original, status: "Cancelled" } } });
  });
  return state;
}

function card(page: Page, name: string) {
  return page.getByRole("region", { name: "Venue bookings" }).getByRole("listitem").filter({ hasText: name });
}

test("an event lists all of its venue bookings with their own status and details", async ({ page }) => {
  await openEvent(page, "Coordinator");
  await page.goto(`/events/${EVENT_ID}`);

  await expect(card(page, "Main auditorium")).toContainText("Confirmed");
  await expect(card(page, "Main auditorium")).toContainText("Theatre · 150 people");
  await expect(card(page, "Breakout room")).toContainText("Requested");
  await expect(page.getByRole("link", { name: "Add another venue" }))
    .toHaveAttribute("href", `/venues/bookings/new?eventId=${EVENT_ID}`);
  await expect(card(page, "Main auditorium").getByRole("link", { name: "Change" }))
    .toHaveAttribute("href", "/venues/bookings/a/edit");
  await expect(card(page, "Breakout room").getByRole("link", { name: "Change" }))
    .toHaveAttribute("href", "/venues/bookings/b/edit");
});

test("cancelling one venue booking leaves the other untouched", async ({ page }) => {
  const state = await openEvent(page, "Coordinator");
  await page.goto(`/events/${EVENT_ID}`);

  await card(page, "Breakout room").getByRole("button", { name: "Cancel" }).click();

  await expect(card(page, "Breakout room")).toContainText("Cancelled");
  await expect(card(page, "Breakout room").getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(card(page, "Main auditorium")).toContainText("Confirmed");
  await expect(card(page, "Main auditorium").getByRole("button", { name: "Cancel" })).toBeVisible();
  expect(state.cancelled).toEqual(["b"]);
});

test("a refused cancellation is explained and the booking keeps its status", async ({ page }) => {
  const state = await openEvent(page, "Coordinator");
  state.failCancel = true;
  await page.goto(`/events/${EVENT_ID}`);

  await card(page, "Main auditorium").getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("region", { name: "Venue bookings" }).getByRole("alert"))
    .toHaveText("This booking can no longer be cancelled.");
  await expect(card(page, "Main auditorium")).toContainText("Confirmed");
  await expect(card(page, "Breakout room")).toContainText("Requested");
});

for (const role of ["Organiser", "Venue Staff"] as const) {
  test(`${role} sees every venue booking but cannot change or cancel them`, async ({ page }) => {
    await openEvent(page, role);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(card(page, "Main auditorium")).toBeVisible();
    await expect(card(page, "Breakout room")).toBeVisible();
    await expect(page.getByRole("region", { name: "Venue bookings" }).getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Add another venue" })).toHaveCount(0);
  });
}
