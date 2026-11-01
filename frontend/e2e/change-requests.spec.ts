import { expect, test, type Page } from "@playwright/test";

// SCRUM-46: organisers request changes after submission; the assigned Coordinator reviews them.
const EVENT_ID = "46464646-4646-4464-8464-464646464646";
const API_ORIGIN = "http://localhost:5001";

const PENDING_REQUEST = {
  id: 7,
  event_id: EVENT_ID,
  requested_by: 1,
  description: "Move the start time to 10am",
  status: "Pending",
  reviewed_by: null,
  review_note: null,
  requested_at: "2026-10-25T02:00:00Z",
  reviewed_at: null,
};

function eventWithStatus(status: string) {
  return {
    id: EVENT_ID,
    title: "Robotics showcase",
    status,
    request_status: status,
    organiser_id: 1,
    coordinator_id: 2,
    updated_at: "2026-10-25T01:00:00Z",
    last_status_changed_at: "2026-10-25T01:00:00Z",
    last_status_changed_by: 2,
  };
}

async function openEvent(
  page: Page,
  role: "Organiser" | "Coordinator" | "Venue Staff",
  status = "Confirmed",
) {
  const userId = { Organiser: 1, Coordinator: 2, "Venue Staff": 3 }[role];
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
}

test("organiser raises a change request on a confirmed event without editing it directly", async ({ page }) => {
  await openEvent(page, "Organiser");
  let sentBody: unknown;
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/change-requests`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { change_requests: [] } });
      return;
    }
    sentBody = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { change_request: PENDING_REQUEST } });
  });

  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByRole("heading", { name: "Robotics showcase" })).toBeVisible();
  await expect(page.getByText("No change requests have been raised.")).toBeVisible();
  await expect(page.getByText("Edit event details")).toHaveCount(0);

  await page.getByLabel("Describe the desired change").fill("  Move the start time to 10am  ");
  await page.getByRole("button", { name: "Request a change" }).click();

  await expect(page.getByTestId("change-request-status-badge")).toHaveText("Pending");
  await expect(page.getByText("Move the start time to 10am")).toBeVisible();
  await expect(page.getByLabel("Describe the desired change")).toHaveValue("");
  expect(sentBody).toEqual({ description: "  Move the start time to 10am  " });
  await expect(page.getByRole("button", { name: "Approve change" })).toHaveCount(0);
});

test("organiser proposes a new date/time, sent as an ISO instant (SCRUM-48)", async ({ page }) => {
  await openEvent(page, "Organiser");
  let sent: { description?: string; changes?: Record<string, string> } = {};
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/change-requests`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { change_requests: [] } });
      return;
    }
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { change_request: PENDING_REQUEST } });
  });

  await page.goto(`/events/${EVENT_ID}`);
  await page.getByLabel("Describe the desired change").fill("Reschedule this event");
  await page.locator("summary", { hasText: "Propose new values" }).click();
  await page.locator("#change-event_datetime").fill("2026-11-18T11:30");
  await page.getByRole("button", { name: "Request a change" }).click();

  await expect(page.getByTestId("change-request-status-badge")).toHaveText("Pending");
  expect(sent.description).toBe("Reschedule this event");
  // datetime-local (no zone) is converted to an ISO instant; exact UTC is unit-tested in lib.
  expect(sent.changes?.event_datetime).toMatch(/T.*Z$/);
  expect(Number.isNaN(Date.parse(sent.changes?.event_datetime ?? ""))).toBe(false);
});

test("coordinator reviews and approves a pending change request", async ({ page }) => {
  await openEvent(page, "Coordinator");
  const reviews: unknown[] = [];
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/change-requests`, (route) =>
    route.fulfill({ json: { change_requests: [PENDING_REQUEST] } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/change-requests/7`, async (route) => {
    const body = route.request().postDataJSON();
    reviews.push(body);
    await route.fulfill({ json: { change_request: {
      ...PENDING_REQUEST, status: body.status, reviewed_by: 2, reviewed_at: "2026-10-25T03:00:00Z",
    } } });
  });

  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByTestId("change-request-status-badge")).toHaveText("Pending");
  await expect(page.getByLabel("Describe the desired change")).toHaveCount(0);

  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByTestId("change-request-status-badge")).toHaveText("Under Review");
  await expect(page.getByRole("button", { name: "Start review" })).toHaveCount(0);

  await page.unroute(`${API_ORIGIN}/events/${EVENT_ID}/history`);
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/history`, (route) => route.fulfill({ json: {
    history: [{
      id: 1, event_id: EVENT_ID, old_status: "Confirmed", new_status: "Confirmed",
      changed_by: 2, changed_at: "2026-10-25T03:00:00Z", action: "change_request_approved", note: null,
    }],
  } }));
  await page.getByRole("button", { name: "Approve change" }).click();

  await expect(page.getByTestId("change-request-status-badge")).toHaveText("Approved");
  await expect(page.getByRole("button", { name: "Approve change" })).toHaveCount(0);
  await page.locator("summary").filter({ hasText: "Status history" }).click();
  await expect(page.getByText("Change Request Approved")).toBeVisible();
  expect(reviews).toEqual([{ status: "Under Review" }, { status: "Approved" }]);
});

for (const status of ["Rejected", "Cancelled"]) {
  test(`organiser cannot raise a change request on a ${status} event`, async ({ page }) => {
    await openEvent(page, "Organiser", status);
    await page.route(`${API_ORIGIN}/events/${EVENT_ID}/change-requests`, (route) =>
      route.fulfill({ json: { change_requests: [] } }));

    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole("heading", { name: "Change requests" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Request a change" })).toHaveCount(0);
  });
}

test("venue staff can open the event without loading change requests", async ({ page }) => {
  await openEvent(page, "Venue Staff");
  let changeRequestCalls = 0;
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/change-requests`, async (route) => {
    changeRequestCalls += 1;
    await route.fulfill({ status: 403, json: { error: "You do not have permission to perform this action." } });
  });

  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByRole("heading", { name: "Robotics showcase" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Change requests" })).toHaveCount(0);
  expect(changeRequestCalls).toBe(0);
});

test("the event stays visible when change requests cannot be loaded", async ({ page }) => {
  await openEvent(page, "Organiser");
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/change-requests`, (route) =>
    route.fulfill({ status: 503, json: { error: "Could not load the event change requests." } }));

  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByRole("heading", { name: "Robotics showcase" })).toBeVisible();
  await expect(page.getByText("Existing change requests could not be loaded.")).toBeVisible();
  await expect(page.getByText("No change requests have been raised.")).toHaveCount(0);
});
