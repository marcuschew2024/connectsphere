import { expect, test, type Page } from "./fixtures";

// SCRUM-156: a significant change awaiting re-review is shown as such to both roles, and
// marking it implemented asks for confirmation. The API is mocked; what is stored and sent
// is covered by api/tests/test_re_review_presentation_acceptance.py.
const EVENT_ID = "15600000-0000-4000-8000-000000000001";
const API = "http://localhost:5001";
const WARNING = "Expected attendance (80 pax) exceeds venue capacity (60 pax) by 20 pax.";

const EVENT = {
  id: EVENT_ID, title: "Test Event 01", status: "Planning", request_status: "Planning",
  organiser_id: 1, coordinator_id: 2, expected_attendance: 80, venue_requirements: "Seminar room",
  category: "Workshop", updated_at: "2026-10-31T01:00:00Z",
  last_status_changed_at: "2026-10-31T01:00:00Z", last_status_changed_by: 2,
};

const IN_RE_REVIEW = {
  id: 9, event_id: EVENT_ID, requested_by: 1, description: "More students signed up",
  status: "Approved", reviewed_by: 2, review_note: null,
  requested_at: "2026-10-31T02:00:00Z", reviewed_at: "2026-10-31T03:00:00Z",
  requested_changes: { expected_attendance: 80 },
  applied_changes: { expected_attendance: { from: 40, to: 80 } }, significant: true,
};

async function open(page: Page, role: "Organiser" | "Coordinator") {
  const reviews: unknown[] = [];
  await page.route("**/notifications", (r) => r.fulfill({ json: { notifications: [] } }));
  await page.route("**/session", (r) => r.fulfill({ json: {
    user: { id: role === "Organiser" ? 1 : 2, display_name: `Demo ${role}`, role },
  } }));
  await page.route(`${API}/events/${EVENT_ID}`, (r) => r.fulfill({ json: { event: EVENT } }));
  await page.route(`${API}/events/${EVENT_ID}/clarification`, (r) => r.fulfill({ json: { clarification: null } }));
  await page.route(`${API}/events/${EVENT_ID}/change-requests`, (r) => r.fulfill({ json: { change_requests: [IN_RE_REVIEW] } }));
  await page.route(`${API}/events/${EVENT_ID}/history`, (r) => r.fulfill({ json: { history: [
    { id: 1, event_id: EVENT_ID, old_status: "Planning", new_status: "Planning", changed_by: 2,
      changed_at: "2026-10-31T03:00:00Z", action: "change_request_approved_re_review", note: null },
  ] } }));
  await page.route(`${API}/venues/bookings/event/${EVENT_ID}`, (r) => r.fulfill({ json: { bookings: [{
    id: "15600000-0000-4000-8000-000000000002", event_id: EVENT_ID,
    venue_id: "15600000-0000-4000-8000-000000000003", start_at: "2099-11-02T06:00:00Z",
    end_at: "2099-11-02T07:00:00Z", expected_attendance: 40, layout: "Classroom", status: "Confirmed",
    venue: { name: "Cedar Seminar Room", location: "SIS L2" }, capacity_warning: WARNING,
  }] } }));
  await page.route(`${API}/events/${EVENT_ID}/change-requests/9`, (r) => {
    reviews.push(r.request().postDataJSON());
    return r.fulfill({ json: { change_request: { ...IN_RE_REVIEW, status: "Implemented" } } });
  });
  await page.goto(`/events/${EVENT_ID}`);
  return reviews;
}

test("the Organiser sees the change is in re-review and why the venue is a problem", async ({ page }) => {
  await open(page, "Organiser");

  const changes = page.getByRole("region", { name: "Change requests" });
  await expect(changes.getByTestId("change-request-status-badge")).toHaveText("Approved · Re-review in progress");
  const banner = changes.getByRole("status").filter({ hasText: "Re-review needed" });
  await expect(banner).toContainText("your Coordinator is re-reviewing the venue and equipment arrangements");
  await expect(banner).toContainText(`Cedar Seminar Room: ${WARNING}`);
  await expect(banner).toContainText("raise a new change request with a lower number of attendees");
  await expect(changes.getByRole("button", { name: "Mark as implemented" })).toHaveCount(0);
});

test("the Coordinator must confirm the re-review before marking it implemented", async ({ page }) => {
  const reviews = await open(page, "Coordinator");
  const changes = page.getByRole("region", { name: "Change requests" });

  await changes.getByRole("button", { name: "Mark as implemented" }).click();
  const confirm = changes.getByRole("group", { name: "Confirm the re-review is complete" });
  await expect(confirm).toContainText(`Still unresolved: Cedar Seminar Room: ${WARNING}`);
  await confirm.getByRole("button", { name: "Not yet" }).click();
  expect(reviews).toEqual([]);
  await expect(changes.getByTestId("change-request-status-badge")).toHaveText("Approved · Re-review in progress");

  await changes.getByRole("button", { name: "Mark as implemented" }).click();
  await changes.getByRole("button", { name: "Yes, re-review complete" }).click();
  await expect(changes.getByTestId("change-request-status-badge")).toHaveText("Implemented");
  expect(reviews).toEqual([{ status: "Implemented" }]);
});

test("status history names the approval as needing re-review", async ({ page }) => {
  await open(page, "Coordinator");
  await page.locator("summary").filter({ hasText: "Status history" }).click();

  await expect(page.getByText("Change Request Approved — Re-review Required", { exact: true })).toBeVisible();
});
