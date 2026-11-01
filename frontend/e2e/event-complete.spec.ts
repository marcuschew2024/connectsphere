import { expect, test, type Page } from "./fixtures";

// SCRUM-132: the assigned Coordinator completes and closes a delivered event.
const EVENT_ID = "13213213-2132-4132-8132-132132132132";
const API_ORIGIN = "http://localhost:5001";

function eventWithStatus(status: string) {
  return {
    id: EVENT_ID,
    title: "Hackathon finals",
    status,
    request_status: status,
    organiser_id: 1,
    coordinator_id: 2,
    updated_at: "2026-10-25T01:00:00Z",
    last_status_changed_at: "2026-10-25T01:00:00Z",
    last_status_changed_by: 2,
  };
}

const CONFIRMED_BOOKING = {
  id: "booking-1",
  event_id: EVENT_ID,
  venue_id: "venue-1",
  status: "Confirmed",
  start_at: "2026-10-24T01:00:00Z",
  end_at: "2026-10-24T05:00:00Z",
  expected_attendance: 80,
  layout: "Theatre",
  requested_by: 2,
  venue: { name: "Main Hall", location: "Block A" },
};

async function openEvent(page: Page, role: "Organiser" | "Coordinator", status: string) {
  const userId = role === "Organiser" ? 1 : 2;
  await page.route("**/notifications", (route) => route.fulfill({ json: { notifications: [] } }));
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: userId, display_name: `Demo ${role}`, role },
  } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}`, (route) =>
    route.fulfill({ json: { event: eventWithStatus(status) } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/history`, (route) =>
    route.fulfill({ json: { history: [] } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/clarification`, (route) =>
    route.fulfill({ json: { clarification: null } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/change-requests`, (route) =>
    route.fulfill({ json: { change_requests: [] } }));
  await page.route(`${API_ORIGIN}/venues/bookings/event/${EVENT_ID}`, (route) =>
    route.fulfill({ json: { bookings: [CONFIRMED_BOOKING] } }));
}

test("coordinator completes a delivered event with post-event notes", async ({ page }) => {
  await openEvent(page, "Coordinator", "Preparation");
  let sentBody: unknown;
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/complete`, async (route) => {
    sentBody = route.request().postDataJSON();
    await page.unroute(`${API_ORIGIN}/events/${EVENT_ID}/history`);
    await page.route(`${API_ORIGIN}/events/${EVENT_ID}/history`, (historyRoute) =>
      historyRoute.fulfill({ json: { history: [{
        id: 9, event_id: EVENT_ID, old_status: "Preparation", new_status: "Completed",
        changed_by: 2, changed_at: "2026-10-25T09:00:00Z", action: "event_completed",
        note: "Projector swapped mid-way.",
      }] } }));
    await route.fulfill({ json: {
      event: eventWithStatus("Completed"),
      released: { equipment_reservations: 2, venue_bookings: 1 },
    } });
  });

  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByRole("heading", { name: "Complete event" })).toBeVisible();
  await page.getByLabel("Post-event notes (optional)").fill("Projector swapped mid-way.");
  await page.getByRole("button", { name: "Mark event complete" }).click();
  await expect(page.getByText("Completing an event cannot be undone. Continue?")).toBeVisible();
  await page.getByRole("button", { name: "Confirm completion" }).click();

  await expect(page.getByTestId("event-status-badge")).toHaveText("Completed");
  await expect(page.getByRole("heading", { name: "Event completed and closed" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "read-only" })).toContainText(
    "Released 2 equipment reservation(s) and 1 future venue booking(s).",
  );
  await expect(page.getByRole("heading", { name: "Complete event" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  expect(sentBody).toEqual({ note: "Projector swapped mid-way." });
  await page.locator("summary").filter({ hasText: "Status history" }).click();
  await expect(page.getByText("Event completed", { exact: true })).toBeVisible();
  await expect(page.getByText("Projector swapped mid-way.")).toBeVisible();
});

test("keeping the event open sends nothing", async ({ page }) => {
  await openEvent(page, "Coordinator", "Preparation");
  let calls = 0;
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/complete`, async (route) => {
    calls += 1;
    await route.fulfill({ status: 500, json: { error: "unexpected" } });
  });

  await page.goto(`/events/${EVENT_ID}`);
  await page.getByRole("button", { name: "Mark event complete" }).click();
  await page.getByRole("button", { name: "Keep event open" }).click();

  await expect(page.getByRole("button", { name: "Mark event complete" })).toBeVisible();
  await expect(page.getByTestId("event-status-badge")).toHaveText("Preparation");
  expect(calls).toBe(0);
});

test("coordinator sees why an event cannot be completed yet", async ({ page }) => {
  await openEvent(page, "Coordinator", "Preparation");
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/complete`, (route) => route.fulfill({
    status: 409,
    json: { error: "This event cannot be completed yet. 1 equipment request(s) still awaiting Tech Support." },
  }));

  await page.goto(`/events/${EVENT_ID}`);
  await page.getByRole("button", { name: "Mark event complete" }).click();
  await page.getByRole("button", { name: "Confirm completion" }).click();

  await expect(page.getByTestId("complete-blocked-message")).toContainText(
    "1 equipment request(s) still awaiting Tech Support.",
  );
  await expect(page.getByTestId("event-status-badge")).toHaveText("Preparation");
  await expect(page.getByRole("button", { name: "Mark event complete" })).toBeVisible();
});

for (const [role, status] of [["Organiser", "Preparation"], ["Coordinator", "Confirmed"]] as const) {
  test(`${role} does not see the completion action on a ${status} event`, async ({ page }) => {
    await openEvent(page, role, status);

    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole("heading", { name: "Hackathon finals" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Complete event" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark event complete" })).toHaveCount(0);
  });
}

test("a completed event is shown read-only to the organiser", async ({ page }) => {
  await openEvent(page, "Organiser", "Completed");

  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByTestId("event-status-badge")).toHaveText("Completed");
  await expect(page.getByRole("heading", { name: "Event completed and closed" })).toBeVisible();
  await expect(page.getByText("This event's record is read-only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request a change" })).toHaveCount(0);
  await expect(page.getByText("Main Hall")).toBeVisible();
});

test("a completed event offers the coordinator no booking changes", async ({ page }) => {
  await openEvent(page, "Coordinator", "Completed");

  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByText("Main Hall")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Change" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add another venue" })).toHaveCount(0);
  await expect(page.getByText("Edit event details")).toHaveCount(0);
});
