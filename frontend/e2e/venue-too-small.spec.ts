import { expect, test, type Page } from "@playwright/test";

// SCRUM-152 (SCRUM-47 AC4, SCRUM-62): an attendance change above a booked venue's capacity
// flags that venue. The API is mocked; the capacity re-check itself is covered by
// api/tests/test_venue_too_small_acceptance.py against the real database.
const EVENT_ID = "15200000-0000-4000-8000-000000000001";
const API = "http://localhost:5001";

const EVENT = {
  id: EVENT_ID, title: "Robotics showcase", status: "Planning", request_status: "Planning",
  organiser_id: 1, coordinator_id: 2, expected_attendance: 150, venue_requirements: "Seminar room",
  category: "Showcase", updated_at: "2026-10-31T01:00:00Z",
  last_status_changed_at: "2026-10-31T01:00:00Z", last_status_changed_by: 2,
};

const BOOKING = {
  id: "15200000-0000-4000-8000-000000000002", event_id: EVENT_ID,
  venue_id: "15200000-0000-4000-8000-000000000003", start_at: "2099-11-02T06:00:00Z",
  end_at: "2099-11-02T07:00:00Z", expected_attendance: 50, layout: "Classroom",
  status: "Confirmed", venue: { name: "Seminar Room 2", location: "SIS L2", capacity: 100 },
};

const REQUEST = {
  id: 9, event_id: EVENT_ID, requested_by: 1, description: "More students signed up",
  status: "Pending", reviewed_by: null, review_note: null,
  requested_at: "2026-10-31T02:00:00Z", reviewed_at: null,
  requested_changes: { expected_attendance: 150 }, applied_changes: null, significant: null,
};

async function openAsCoordinator(page: Page, capacityWarning: string | null, requests: unknown[] = []) {
  await page.route("**/notifications", (r) => r.fulfill({ json: { notifications: [] } }));
  await page.route("**/session", (r) => r.fulfill({ json: {
    user: { id: 2, display_name: "Demo Coordinator", role: "Coordinator" },
  } }));
  await page.route(`${API}/events/${EVENT_ID}`, (r) => r.fulfill({ json: { event: EVENT } }));
  await page.route(`${API}/events/${EVENT_ID}/history`, (r) => r.fulfill({ json: { history: [] } }));
  await page.route(`${API}/events/${EVENT_ID}/clarification`, (r) => r.fulfill({ json: { clarification: null } }));
  await page.route(`${API}/events/${EVENT_ID}/change-requests`, (r) => r.fulfill({ json: { change_requests: requests } }));
  await page.route(`${API}/venues/bookings/event/${EVENT_ID}`, (r) => r.fulfill({ json: { bookings: [
    { ...BOOKING, capacity_warning: capacityWarning },
  ] } }));
  await page.goto(`/events/${EVENT_ID}`);
}

test("the bookings panel flags a booked venue that is now too small", async ({ page }) => {
  await openAsCoordinator(page, "Expected attendance (150 pax) exceeds venue capacity (100 pax) by 50 pax.");

  const panel = page.getByRole("region", { name: "Venue bookings" });
  await expect(panel.getByRole("alert")).toHaveText(
    "Venue too small: Expected attendance (150 pax) exceeds venue capacity (100 pax) by 50 pax.");
});

test("a venue that still fits shows no capacity warning", async ({ page }) => {
  await openAsCoordinator(page, null);

  const panel = page.getByRole("region", { name: "Venue bookings" });
  await expect(panel.getByRole("heading", { name: "Seminar Room 2" })).toBeVisible();
  await expect(panel.getByText("Venue too small")).toHaveCount(0);
});

test("approving the attendance increase names the too-small venue", async ({ page }) => {
  await page.route(`${API}/events/${EVENT_ID}/change-requests/9`, (r) => r.fulfill({ json: {
    change_request: { ...REQUEST, status: "Approved", reviewed_by: 2, reviewed_at: "2026-10-31T03:00:00Z",
      applied_changes: { expected_attendance: { from: 50, to: 150 } }, significant: true },
    event: EVENT,
    affected: { venue_bookings: 1, equipment_reservations: 0,
      over_capacity: [{ booking_id: BOOKING.id, venue_name: "Seminar Room 2", capacity: 100 }] },
  } }));
  await openAsCoordinator(page, null, [REQUEST]);

  await page.getByRole("button", { name: "Approve and apply" }).click();

  const changes = page.getByRole("region", { name: "Change requests" });
  await expect(changes.getByRole("alert")).toContainText(
    "Venue too small for the new attendance: Seminar Room 2 (capacity 100).");
});
