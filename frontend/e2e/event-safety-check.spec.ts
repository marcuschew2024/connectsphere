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

async function stubEventPage(page: Page, role: string, userId: number) {
  await page.route("**/session", (route) =>
    route.fulfill({ json: { user: { id: userId, display_name: `Demo ${role}`, role } } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}`, (route) =>
    route.fulfill({ json: { event: confirmedEvent() } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/history`, (route) =>
    route.fulfill({ json: { history: [] } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/clarification`, (route) =>
    route.fulfill({ json: { clarification: null } }));
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
