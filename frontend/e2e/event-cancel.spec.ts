import { expect, test, type Page } from "./fixtures";

// SCRUM-69: the assigned Coordinator or the Event Coordinator Lead cancels an event.
const EVENT_ID = "69696969-6969-4969-8969-696969696969";
const API_ORIGIN = "http://localhost:5001";
const REASON = "Keynote speaker withdrew.";

const USERS = {
  Organiser: 1,
  Coordinator: 2,
  "Venue Staff": 3,
  "Event Coordinator Lead": 8,
} as const;
type Role = keyof typeof USERS;

function eventWith(status: string, coordinatorId: number | null = 2) {
  return {
    id: EVENT_ID,
    title: "Robotics open day",
    status,
    request_status: status,
    organiser_id: 1,
    coordinator_id: coordinatorId,
    updated_at: "2026-10-30T01:00:00Z",
    last_status_changed_at: "2026-10-30T01:00:00Z",
    last_status_changed_by: 2,
  };
}

const CONFIRMED_BOOKING = {
  id: "booking-69",
  event_id: EVENT_ID,
  venue_id: "venue-1",
  status: "Confirmed",
  start_at: "2026-11-20T01:00:00Z",
  end_at: "2026-11-20T05:00:00Z",
  expected_attendance: 80,
  layout: "Theatre",
  requested_by: 2,
  venue: { name: "Main Hall", location: "Block A" },
};

async function openEvent(page: Page, role: Role, status: string, coordinatorId: number | null = 2) {
  await page.route("**/notifications", (route) => route.fulfill({ json: { notifications: [] } }));
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: USERS[role], display_name: `Demo ${role}`, role },
  } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}`, (route) =>
    route.fulfill({ json: { event: eventWith(status, coordinatorId) } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/history`, (route) =>
    route.fulfill({ json: { history: [] } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/clarification`, (route) =>
    route.fulfill({ json: { clarification: null } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/change-requests`, (route) =>
    route.fulfill({ json: { change_requests: [] } }));
  await page.route(`${API_ORIGIN}/venues/bookings/event/${EVENT_ID}`, (route) =>
    route.fulfill({ json: { bookings: [CONFIRMED_BOOKING] } }));
}

async function startCancellation(page: Page, reason = REASON) {
  await page.locator("summary").filter({ hasText: "Cancel event" }).click();
  await page.getByLabel("Reason for cancelling").fill(reason);
  await page.getByRole("button", { name: "Continue to cancellation" }).click();
}

test("assigned coordinator cancels an event, releasing resources and notifying attendees", async ({ page }) => {
  await openEvent(page, "Coordinator", "Confirmed");
  let sentBody: unknown;
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/cancel`, async (route) => {
    sentBody = route.request().postDataJSON();
    await page.unroute(`${API_ORIGIN}/events/${EVENT_ID}/history`);
    await page.route(`${API_ORIGIN}/events/${EVENT_ID}/history`, (historyRoute) =>
      historyRoute.fulfill({ json: { history: [{
        id: 5, event_id: EVENT_ID, old_status: "Confirmed", new_status: "Cancelled",
        changed_by: 2, changed_at: "2026-10-30T09:00:00Z", action: "event_cancelled", note: REASON,
      }] } }));
    await page.unroute(`${API_ORIGIN}/venues/bookings/event/${EVENT_ID}`);
    await page.route(`${API_ORIGIN}/venues/bookings/event/${EVENT_ID}`, (bookingRoute) =>
      bookingRoute.fulfill({ json: { bookings: [{ ...CONFIRMED_BOOKING, status: "Cancelled" }] } }));
    await route.fulfill({ json: {
      event: eventWith("Cancelled"),
      released: { equipment_reservations: 2, venue_bookings: 1 },
      notified_attendees: 3,
    } });
  });

  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByRole("heading", { name: "Robotics open day" })).toBeVisible();
  await startCancellation(page);
  await expect(page.getByText("Cancelling an event cannot be undone. Continue?")).toBeVisible();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();

  await expect(page.getByTestId("event-status-badge")).toHaveText("Cancelled");
  await expect(page.getByRole("heading", { name: "Event cancelled" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "read-only" })).toContainText(
    "Released 1 venue booking(s) and 2 equipment reservation(s). Notified 3 registered attendee(s).",
  );
  await expect(page.locator("summary").filter({ hasText: "Cancel event" })).toHaveCount(0);
  expect(sentBody).toEqual({ reason: REASON });
  await page.locator("summary").filter({ hasText: "Status history" }).click();
  const entry = page.getByRole("listitem").filter({ hasText: REASON });
  await expect(entry).toBeVisible();
  await expect(entry.getByText("Event cancelled", { exact: true })).toBeVisible();
});

test("a reason is required before cancelling", async ({ page }) => {
  await openEvent(page, "Coordinator", "Planning");
  let calls = 0;
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/cancel`, async (route) => {
    calls += 1;
    await route.fulfill({ status: 500, json: { error: "unexpected" } });
  });

  await page.goto(`/events/${EVENT_ID}`);
  await startCancellation(page, "   ");

  await expect(page.getByTestId("cancel-error-message")).toHaveText(
    "Give a reason for cancelling this event.",
  );
  await expect(page.getByRole("button", { name: "Confirm cancellation" })).toHaveCount(0);
  expect(calls).toBe(0);
});

test("keeping the event sends nothing", async ({ page }) => {
  await openEvent(page, "Coordinator", "Planning");
  let calls = 0;
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/cancel`, async (route) => {
    calls += 1;
    await route.fulfill({ status: 500, json: { error: "unexpected" } });
  });

  await page.goto(`/events/${EVENT_ID}`);
  await startCancellation(page);
  await page.getByRole("button", { name: "Keep event" }).click();

  await expect(page.getByRole("button", { name: "Continue to cancellation" })).toBeVisible();
  await expect(page.getByTestId("event-status-badge")).toHaveText("Planning");
  expect(calls).toBe(0);
});

test("a refused cancellation is explained and the event stays open", async ({ page }) => {
  await openEvent(page, "Coordinator", "Confirmed");
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/cancel`, (route) => route.fulfill({
    status: 409, json: { error: "This event is already cancelled." },
  }));

  await page.goto(`/events/${EVENT_ID}`);
  await startCancellation(page);
  await page.getByRole("button", { name: "Confirm cancellation" }).click();

  await expect(page.getByTestId("cancel-error-message")).toHaveText("This event is already cancelled.");
  await expect(page.getByTestId("event-status-badge")).toHaveText("Confirmed");
  await expect(page.getByRole("button", { name: "Continue to cancellation" })).toBeVisible();
});

test("the Event Coordinator Lead can cancel an unassigned submission", async ({ page }) => {
  await openEvent(page, "Event Coordinator Lead", "Submitted", null);
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/cancel`, (route) => route.fulfill({ json: {
    event: eventWith("Cancelled", null),
    released: { equipment_reservations: 0, venue_bookings: 0 },
    notified_attendees: 0,
  } }));

  await page.goto(`/events/${EVENT_ID}`);
  await startCancellation(page);
  await page.getByRole("button", { name: "Confirm cancellation" }).click();

  await expect(page.getByTestId("event-status-badge")).toHaveText("Cancelled");
  await expect(page.getByRole("heading", { name: "Event cancelled" })).toBeVisible();
});

for (const [role, status, coordinatorId] of [
  ["Coordinator", "Confirmed", 7],
  ["Organiser", "Confirmed", 2],
  ["Venue Staff", "Confirmed", 2],
  ["Coordinator", "Completed", 2],
  ["Coordinator", "Rejected", 2],
] as const) {
  test(`${role} sees no cancel action on a ${status} event coordinated by ${coordinatorId}`, async ({ page }) => {
    await openEvent(page, role, status, coordinatorId);

    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole("heading", { name: "Robotics open day" })).toBeVisible();
    await expect(page.locator("summary").filter({ hasText: "Cancel event" })).toHaveCount(0);
  });
}

test("a cancelled event is read-only for the organiser", async ({ page }) => {
  await openEvent(page, "Organiser", "Cancelled");

  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByRole("heading", { name: "Event cancelled" })).toBeVisible();
  await expect(page.getByText("This event has been cancelled and its record is read-only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request a change" })).toHaveCount(0);
});

test("a cancelled event offers the coordinator no further actions", async ({ page }) => {
  await openEvent(page, "Coordinator", "Cancelled");

  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByText("Main Hall")).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "Cancel event" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add another venue" })).toHaveCount(0);
});
