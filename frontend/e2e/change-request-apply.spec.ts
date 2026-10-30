import { expect, test, type Page } from "@playwright/test";

// SCRUM-138: proposed values travel with a change request and approval applies them.
// The API is mocked; the atomic apply, rollback and re-checks are covered by the API's
// route and acceptance tests.
const EVENT_ID = "13813813-8138-4138-8138-138138138138";
const API = "http://localhost:5001";

const EVENT = {
  id: EVENT_ID, title: "Robotics showcase", status: "Confirmed", request_status: "Confirmed",
  organiser_id: 1, coordinator_id: 2, expected_attendance: 50, venue_requirements: "Seminar room",
  category: "Showcase", updated_at: "2026-10-31T01:00:00Z",
  last_status_changed_at: "2026-10-31T01:00:00Z", last_status_changed_by: 2,
};

const PROPOSED = {
  id: 9, event_id: EVENT_ID, requested_by: 1, description: "More students signed up",
  status: "Pending", reviewed_by: null, review_note: null,
  requested_at: "2026-10-31T02:00:00Z", reviewed_at: null,
  requested_changes: { expected_attendance: 150, title: "Robotics showcase 2026" },
  applied_changes: null, significant: null,
};

async function openEvent(page: Page, role: "Organiser" | "Coordinator", requests: unknown[] = []) {
  const state = { requests, posts: [] as unknown[], reviews: [] as unknown[] };
  await page.route("**/notifications", (r) => r.fulfill({ json: { notifications: [] } }));
  await page.route("**/session", (r) => r.fulfill({ json: {
    user: { id: role === "Organiser" ? 1 : 2, display_name: `Demo ${role}`, role },
  } }));
  await page.route(`${API}/events/${EVENT_ID}`, (r) => r.fulfill({ json: { event: EVENT } }));
  await page.route(`${API}/events/${EVENT_ID}/history`, (r) => r.fulfill({ json: { history: [] } }));
  await page.route(`${API}/events/${EVENT_ID}/clarification`, (r) => r.fulfill({ json: { clarification: null } }));
  await page.route(`${API}/events/${EVENT_ID}/change-requests`, async (r) => {
    if (r.request().method() === "GET") return r.fulfill({ json: { change_requests: state.requests } });
    state.posts.push(r.request().postDataJSON());
    return r.fulfill({ status: 201, json: { change_request: PROPOSED } });
  });
  return state;
}

test("organiser proposes new values with a change request", async ({ page }) => {
  const state = await openEvent(page, "Organiser");
  await page.goto(`/events/${EVENT_ID}`);

  await page.getByLabel("Describe the desired change").fill("More students signed up");
  await page.getByText("Propose new values (optional)").click();
  await expect(page.getByLabel("New expected attendance")).toHaveAttribute("placeholder", "Currently: 50");
  await page.getByLabel("New expected attendance").fill("150");
  await page.getByLabel("New title").fill("Robotics showcase 2026");
  await page.getByRole("button", { name: "Request a change" }).click();

  expect(state.posts).toEqual([{
    description: "More students signed up",
    changes: { title: "Robotics showcase 2026", expected_attendance: 150 },
  }]);
  await expect(page.getByText("Proposed values")).toBeVisible();
  await expect(page.getByText("Expected attendance → 150 (significant)")).toBeVisible();
  await expect(page.getByText("Title → Robotics showcase 2026")).toBeVisible();
  await expect(page.getByLabel("New expected attendance")).toHaveValue("");
});

test("an invalid proposed value is explained next to its field and nothing is lost", async ({ page }) => {
  await openEvent(page, "Organiser");
  await page.route(`${API}/events/${EVENT_ID}/change-requests`, (r) => r.request().method() === "GET"
    ? r.fulfill({ json: { change_requests: [] } })
    : r.fulfill({ status: 400, json: {
      error: "Please check the proposed changes.",
      fields: { expected_attendance: "This is already the current value." },
    } }));
  await page.goto(`/events/${EVENT_ID}`);
  await page.getByLabel("Describe the desired change").fill("Same size");
  await page.getByText("Propose new values (optional)").click();
  await page.getByLabel("New expected attendance").fill("50");
  await page.getByRole("button", { name: "Request a change" }).click();

  await expect(page.getByRole("region", { name: "Change requests" }).getByRole("alert")).toHaveText("Please check the proposed changes.");
  await expect(page.getByText("This is already the current value.")).toBeVisible();
  await expect(page.getByLabel("New expected attendance")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Describe the desired change")).toHaveValue("Same size");
  await expect(page.getByLabel("New expected attendance")).toHaveValue("50");
});

test("approving a significant change applies it, flags re-review and can be marked implemented", async ({ page }, testInfo) => {
  const state = await openEvent(page, "Coordinator", [PROPOSED]);
  await page.route(`${API}/events/${EVENT_ID}/change-requests/9`, (r) => {
    const body = r.request().postDataJSON();
    state.reviews.push(body);
    const approved = {
      ...PROPOSED, status: body.status, reviewed_by: 2, reviewed_at: "2026-10-31T03:00:00Z",
      applied_changes: {
        expected_attendance: { from: 50, to: 150 },
        title: { from: "Robotics showcase", to: "Robotics showcase 2026" },
      },
      significant: true,
    };
    return r.fulfill({ json: body.status === "Approved"
      ? { change_request: approved, event: { ...EVENT, expected_attendance: 150, title: "Robotics showcase 2026" },
        affected: { venue_bookings: 2, equipment_reservations: 1 } }
      : { change_request: approved } });
  });
  await page.goto(`/events/${EVENT_ID}`);

  await expect(page.getByText("Expected attendance → 150 (significant)")).toBeVisible();
  await page.getByRole("button", { name: "Approve and apply" }).click();

  await expect(page.getByTestId("change-request-status-badge")).toHaveText("Approved");
  await expect(page.getByText("Applied to the event")).toBeVisible();
  await expect(page.getByText("Expected attendance: 50 → 150")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Robotics showcase 2026" })).toBeVisible();
  const banner = page.getByRole("status").filter({ hasText: "Re-review needed" });
  await expect(banner).toContainText("Nothing was cancelled");
  await expect(page.getByText("Re-check 2 venue booking(s) and 1 equipment reservation(s). Nothing was cancelled.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("change-applied.png"), fullPage: true });

  await page.getByRole("button", { name: "Mark as implemented" }).click();
  await expect(page.getByTestId("change-request-status-badge")).toHaveText("Implemented");
  await expect(page.getByText("Re-review needed")).toHaveCount(0);
  await expect(page.getByText("Expected attendance: 50 → 150")).toBeVisible();
  expect(state.reviews).toEqual([{ status: "Approved" }, { status: "Implemented" }]);
});

test("an ordinary change is applied without a re-review flag", async ({ page }) => {
  const ordinary = { ...PROPOSED, requested_changes: { title: "Robotics showcase 2026" } };
  await openEvent(page, "Coordinator", [ordinary]);
  await page.route(`${API}/events/${EVENT_ID}/change-requests/9`, (r) => r.fulfill({ json: {
    change_request: { ...ordinary, status: "Approved", significant: false,
      applied_changes: { title: { from: "Robotics showcase", to: "Robotics showcase 2026" } } },
    event: { ...EVENT, title: "Robotics showcase 2026" },
    affected: { venue_bookings: 1, equipment_reservations: 0 },
  } }));
  await page.goto(`/events/${EVENT_ID}`);
  await page.getByRole("button", { name: "Approve and apply" }).click();

  await expect(page.getByText("Title: Robotics showcase → Robotics showcase 2026")).toBeVisible();
  await expect(page.getByText("Re-review needed")).toHaveCount(0);
  await expect(page.getByText(/Re-check \d+ venue booking/)).toHaveCount(0);
});

test("a failed approval is shown to the coordinator and changes nothing on screen", async ({ page }) => {
  await openEvent(page, "Coordinator", [PROPOSED]);
  await page.route(`${API}/events/${EVENT_ID}/change-requests/9`, (r) => r.fulfill({ status: 503, json: {
    error: "Could not apply the change. The event was not changed; contact the team.",
  } }));
  await page.goto(`/events/${EVENT_ID}`);
  await page.getByRole("button", { name: "Approve and apply" }).click();

  await expect(page.getByRole("region", { name: "Change requests" }).getByRole("alert")).toHaveText(
    "Could not apply the change. The event was not changed; contact the team.");
  await expect(page.getByTestId("change-request-status-badge")).toHaveText("Pending");
  await expect(page.getByRole("heading", { name: "Robotics showcase", exact: true })).toBeVisible();
  await expect(page.getByText("Applied to the event")).toHaveCount(0);
});

test("the proposal form fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openEvent(page, "Organiser");
  await page.goto(`/events/${EVENT_ID}`);
  await page.getByText("Propose new values (optional)").click();
  await expect(page.getByLabel("New registration requirements")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
