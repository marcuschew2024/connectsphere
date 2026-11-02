import { expect, test, type Page } from "./fixtures";

// SCRUM-166 (audit R4): a rescheduled event is back in Planning, its history says why,
// and confirmation names what no longer covers the event. The API is mocked with its
// real refusal text; the rules are proven against the database by
// api/tests/test_reschedule_returns_to_planning_acceptance.py.
const EVENT_ID = "16600000-0000-4000-8000-000000000001";
const API = "http://localhost:5001";

const UNCOVERED = "This event cannot be confirmed yet. The approved venue bookings do not cover the event's full time; book a venue for the uncovered part.";
const MISTIMED = "This event cannot be confirmed yet. 1 equipment reservation(s) do not cover the event's time and must be re-reserved.";

const event = (status = "Planning") => ({
  id: EVENT_ID, title: "Annual tech conference", status, request_status: status,
  organiser_id: 1, coordinator_id: 2, event_datetime: "2099-12-20T06:00:00Z",
  event_end_datetime: "2099-12-20T08:00:00Z", updated_at: "2026-11-03T10:00:00Z",
  last_status_changed_at: "2026-11-03T10:00:00Z", last_status_changed_by: 2,
});

async function asCoordinator(page: Page, confirmReply: { status: number; json: object }) {
  await page.route("**/session", (route) => route.fulfill({
    json: { user: { id: 2, display_name: "Demo Coordinator", role: "Coordinator" } },
  }));
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill({ json: { event: event() } }));
  await page.route(`${API}/events/${EVENT_ID}/clarification`, (route) => route.fulfill({ json: { clarification: null } }));
  await page.route(`${API}/events/${EVENT_ID}/history`, (route) => route.fulfill({ json: { history: [
    { id: 1, event_id: EVENT_ID, old_status: "Confirmed", new_status: "Planning", changed_by: 2,
      changed_at: "2026-11-03T10:00:00Z", action: "rescheduled_returned_to_planning",
      note: "Rescheduled: re-confirm the venue bookings and equipment for the new time; the safety check runs again after confirmation." },
  ] } }));
  await page.route(`${API}/events/${EVENT_ID}/confirm`, (route) => route.fulfill(confirmReply));
  await page.goto(`/events/${EVENT_ID}`);
}

test("a rescheduled event shows it returned to Planning and why", async ({ page }) => {
  await asCoordinator(page, { status: 409, json: { error: UNCOVERED } });

  await expect(page.getByTestId("event-status-badge")).toHaveText("Planning");
  await expect(page.getByRole("button", { name: "Confirm event" })).toBeVisible();
  await page.locator("summary").filter({ hasText: "Status history" }).click();
  await expect(page.getByText("Rescheduled — Returned to Planning", { exact: true })).toBeVisible();
  await expect(page.getByText("the safety check runs again after confirmation", { exact: false })).toBeVisible();
});

for (const [why, error, fragment] of [
  ["venue bookings leave part of the event uncovered", UNCOVERED, "do not cover the event's full time"],
  ["an equipment reservation misses the event's time", MISTIMED, "equipment reservation(s) do not cover"],
] as const) {
  test(`confirmation is blocked when ${why}`, async ({ page }) => {
    await asCoordinator(page, { status: 409, json: { error } });

    await page.getByRole("button", { name: "Confirm event" }).click();

    await expect(page.getByTestId("confirm-blocked-message")).toContainText(fragment);
    await expect(page.getByTestId("event-status-badge")).toHaveText("Planning");
  });
}

test("once the new time is covered the event confirms", async ({ page }) => {
  await asCoordinator(page, { status: 200, json: { event: event("Confirmed") } });

  await page.getByRole("button", { name: "Confirm event" }).click();

  await expect(page.getByTestId("event-status-badge")).toHaveText("Confirmed");
});
