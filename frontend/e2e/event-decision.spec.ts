import { expect, test, type Page } from "@playwright/test";

// Core feature #4 (SCRUM-18): the assigned Coordinator approves a submitted request
// (→ Planning) or rejects it with a required reason (→ Rejected). The clarification/
// return path is covered in events.spec.ts; this pins the approve/reject decision.
const API = "http://localhost:5001";
const EVENT_ID = "18181818-1818-4188-8188-181818181818";

const SUBMITTED = {
  id: EVENT_ID, title: "Campus workshop", status: "Submitted", request_status: "Submitted",
  organiser_id: 1, coordinator_id: 2, category: "Workshop", expected_attendance: 40,
  event_datetime: "2099-10-20T06:00:00Z", updated_at: "2026-10-31T01:00:00Z",
};

// Mock the reads the event detail page makes so only the decision POST is under test.
async function openAsCoordinator(page: Page) {
  const state = { decisions: [] as unknown[] };
  await page.route("**/notifications", (r) => r.fulfill({ json: { notifications: [] } }));
  await page.route("**/session", (r) => r.fulfill({ json: {
    user: { id: 2, display_name: "Demo Coordinator", role: "Coordinator" },
  } }));
  await page.route(`${API}/events/${EVENT_ID}/history`, (r) => r.fulfill({ json: { history: [] } }));
  await page.route(`${API}/events/${EVENT_ID}/clarification`, (r) => r.fulfill({ json: { clarification: null } }));
  await page.route(`${API}/events/${EVENT_ID}/change-requests`, (r) => r.fulfill({ json: { change_requests: [] } }));
  await page.route(`${API}/venues/bookings/event/${EVENT_ID}`, (r) => r.fulfill({ json: { bookings: [] } }));
  await page.route(`${API}/events/${EVENT_ID}`, (r) => r.fulfill({ json: { event: SUBMITTED } }));
  await page.route(`${API}/events/${EVENT_ID}/decision`, (r) => {
    const body = r.request().postDataJSON();
    state.decisions.push(body);
    const status = body.decision === "approve" ? "Planning" : "Rejected";
    return r.fulfill({ json: { event: { ...SUBMITTED, status, request_status: status } } });
  });
  return state;
}

test("coordinator approves a submitted request and the review controls close", async ({ page }) => {
  const state = await openAsCoordinator(page);
  await page.goto(`/events/${EVENT_ID}`);

  await expect(page.getByRole("heading", { name: "Review request" })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();

  expect(state.decisions).toEqual([{ decision: "approve" }]);
  // Once approved the event is no longer Submitted, so the review form is gone.
  await expect(page.getByRole("heading", { name: "Review request" })).toHaveCount(0);
});

test("rejecting without a reason is blocked inline and posts nothing", async ({ page }) => {
  const state = await openAsCoordinator(page);
  await page.goto(`/events/${EVENT_ID}`);

  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("A reason is required when rejecting a request.")).toBeVisible();
  expect(state.decisions).toEqual([]);
});

test("coordinator rejects with a reason and the reason is sent", async ({ page }) => {
  const state = await openAsCoordinator(page);
  await page.goto(`/events/${EVENT_ID}`);

  await page.getByLabel("Rejection reason").fill("Venue requirements cannot be met.");
  await page.getByRole("button", { name: "Reject" }).click();

  expect(state.decisions).toEqual([{ decision: "reject", reason: "Venue requirements cannot be met." }]);
  await expect(page.getByRole("heading", { name: "Review request" })).toHaveCount(0);
});

// Core feature #7 (SCRUM-23): the assigned Coordinator edits event details while the event
// is in Planning. The PATCH route is shared with draft edits (covered in drafts.spec.ts); this
// pins the coordinator Planning-edit path through EventEditForm (no action:"draft").
const PLANNING = {
  id: EVENT_ID, title: "Campus workshop", status: "Planning", request_status: "Planning",
  organiser_id: 1, coordinator_id: 2, category: "Workshop", expected_attendance: 40,
  event_datetime: "2099-10-20T06:00:00Z", venue_requirements: "Seminar room",
  accessibility_requirements: "Step-free access", equipment_requirements: "Projector",
  registration_requirements: "RSVP", updated_at: "2026-10-31T01:00:00Z",
};

test("coordinator edits event details during Planning and the change is saved", async ({ page }) => {
  const edits: Array<Record<string, unknown>> = [];
  await page.route("**/notifications", (r) => r.fulfill({ json: { notifications: [] } }));
  await page.route("**/session", (r) => r.fulfill({ json: {
    user: { id: 2, display_name: "Demo Coordinator", role: "Coordinator" },
  } }));
  await page.route(`${API}/events/${EVENT_ID}/history`, (r) => r.fulfill({ json: { history: [] } }));
  await page.route(`${API}/events/${EVENT_ID}/clarification`, (r) => r.fulfill({ json: { clarification: null } }));
  await page.route(`${API}/events/${EVENT_ID}/change-requests`, (r) => r.fulfill({ json: { change_requests: [] } }));
  await page.route(`${API}/venues/bookings/event/${EVENT_ID}`, (r) => r.fulfill({ json: { bookings: [] } }));
  await page.route(`${API}/events/${EVENT_ID}`, (r) => {
    if (r.request().method() === "PATCH") {
      const body = r.request().postDataJSON();
      edits.push(body);
      return r.fulfill({ json: {
        event: { ...PLANNING, title: body.title }, importance: "ordinary", changed_fields: ["title"],
      } });
    }
    return r.fulfill({ json: { event: PLANNING } });
  });

  await page.goto(`/events/${EVENT_ID}`);
  await page.locator("summary").filter({ hasText: "Edit event details" }).click();
  await page.getByLabel("Event name").fill("Campus workshop (revised)");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Saved. Recorded as an ordinary change.")).toBeVisible();
  expect(edits).toHaveLength(1);
  expect(edits[0].title).toBe("Campus workshop (revised)");
  // A coordinator Planning edit is not a draft save.
  expect(edits[0].action).toBeUndefined();
});
