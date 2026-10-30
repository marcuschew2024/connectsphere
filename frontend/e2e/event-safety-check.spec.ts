import { expect, test, type Page } from "@playwright/test";

const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const API_ORIGIN = "http://localhost:5001";

function confirmedEvent() {
  return {
    id: EVENT_ID,
    title: "Campus open day",
    status: "Confirmed",
    request_status: "Confirmed",
    expected_attendance: 300,
    venue_requirements: "Main hall + overflow",
    accessibility_requirements: "Step-free access",
    equipment_requirements: "PA system",
    organiser_id: 1,
    coordinator_id: 2,
    updated_at: "2026-10-05T10:00:00Z",
    last_status_changed_at: "2026-10-05T10:00:00Z",
    last_status_changed_by: 2,
  };
}

// SCRUM-145 (R16): the event-scoped venue + technical detail the Safety Officer's panel shows.
const SAFETY_DETAIL = {
  bookings: [{
    id: "b1", event_id: EVENT_ID, venue_id: "v1",
    start_at: "2099-10-20T06:00:00Z", end_at: "2099-10-20T10:00:00Z",
    status: "Confirmed", layout: "Theatre", expected_attendance: 300,
    requested_by: 2, requested_at: "2026-10-01T00:00:00Z",
    decision_reason: null, suggested_alternative: null, decided_by: null,
    decision_at: null, special_requirements: null,
    venue: { name: "Main Hall", location: "Level 1" },
  }],
  venues: [{
    id: "v1", name: "Main Hall", location: "Level 1", capacity: 500,
    supported_layouts: ["Theatre", "Banquet"],
    accessibility: ["Step-free", "Hearing loop"],
    facilities: ["AED", "Fire exits"],
  }],
  equipment: { reservations: [{
    id: "r1", quantity: 2, status: "Reserved",
    equipment: { equipment_type: "PA system", location: "Store A" },
  }] },
};

async function stubEventPage(page: Page, role: string, userId: number) {
  await page.route("**/session", (route) =>
    route.fulfill({ json: { user: { id: userId, display_name: `Demo ${role}`, role } } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}`, (route) =>
    route.fulfill({ json: { event: confirmedEvent() } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/history`, (route) =>
    route.fulfill({ json: { history: [] } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/clarification`, (route) =>
    route.fulfill({ json: { clarification: null } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/safety-review-details`, (route) =>
    route.fulfill({ json: SAFETY_DETAIL }));
}

// A Safety Officer approves a confirmed event and it moves to Preparation (AC: approval proceeds).
test("safety officer approves and the event moves to Preparation", async ({ page }) => {
  await stubEventPage(page, "Safety Officer", 6);
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/safety-check`, (route) =>
    route.fulfill({ json: { event: { ...confirmedEvent(), status: "Preparation", request_status: "Preparation" } } }));

  await page.goto(`/events/${EVENT_ID}`);
  await page.getByRole("button", { name: "Approve for preparation" }).click();

  await expect(page.getByTestId("event-status-badge")).toHaveText("Preparation");
});

// SCRUM-145 (R16): the Safety Officer sees the venue + technical detail needed to decide.
test("safety officer sees read-only venue and technical detail panels", async ({ page }) => {
  await stubEventPage(page, "Safety Officer", 6);

  await page.goto(`/events/${EVENT_ID}`);
  const panel = page.getByRole("region", { name: "Venue & technical detail" });

  await expect(panel).toContainText("Main Hall");
  await expect(panel).toContainText("500"); // venue capacity
  await expect(panel).toContainText("Theatre, Banquet"); // supported layouts
  await expect(panel).toContainText("Step-free, Hearing loop"); // accessibility
  await expect(panel).toContainText("AED, Fire exits"); // facilities
  await expect(panel).toContainText("PA system"); // equipment reservation
  // Read-only: no management controls in the panel.
  await expect(panel.getByRole("button")).toHaveCount(0);
  await expect(panel.getByRole("link")).toHaveCount(0);
});

// Requesting changes without a reason is blocked client-side (AC: reason required).
test("requesting changes without a reason shows a validation message", async ({ page }) => {
  await stubEventPage(page, "Safety Officer", 6);

  await page.goto(`/events/${EVENT_ID}`);
  await page.getByRole("button", { name: "Request changes" }).click();

  await expect(page.getByTestId("safety-error")).toContainText("reason is required");
  await expect(page.getByTestId("event-status-badge")).toHaveText("Confirmed");
});

// A non-Safety-Officer never sees the safety check action (AC: unauthorised access).
test("a coordinator does not see the safety check", async ({ page }) => {
  await stubEventPage(page, "Coordinator", 2);

  await page.goto(`/events/${EVENT_ID}`);

  await expect(page.getByRole("heading", { name: "Campus open day" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve for preparation" })).toHaveCount(0);
});
