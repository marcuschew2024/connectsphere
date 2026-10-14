import { expect, test, type Page } from "@playwright/test";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const API_ORIGIN = "http://localhost:5001";

function planningEvent() {
  return {
    id: EVENT_ID,
    title: "Annual tech conference",
    status: "Planning",
    request_status: "Planning",
    organiser_id: 1,
    coordinator_id: 2,
    updated_at: "2026-10-01T10:00:00Z",
    last_status_changed_at: "2026-10-01T10:00:00Z",
    last_status_changed_by: 2,
  };
}

async function stubEventPage(page: Page, role: string) {
  await page.route("**/session", (route) =>
    route.fulfill({ json: { user: { id: role === "Coordinator" ? 2 : 1, display_name: `Demo ${role}`, role } } }),
  );
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}`, (route) =>
    route.fulfill({ json: { event: planningEvent() } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/history`, (route) =>
    route.fulfill({ json: { history: [] } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/clarification`, (route) =>
    route.fulfill({ json: { clarification: null } }));
}

// A Coordinator confirms a Planning event whose venue bookings are all approved (AC1).
test("coordinator confirms an event and the status becomes Confirmed", async ({ page }) => {
  await stubEventPage(page, "Coordinator");
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/confirm`, (route) =>
    route.fulfill({ json: { event: { ...planningEvent(), status: "Confirmed", request_status: "Confirmed" } } }));

  await page.goto(`/events/${EVENT_ID}`);
  await page.getByRole("button", { name: "Confirm event" }).click();

  await expect(page.getByTestId("event-status-badge")).toHaveText("Confirmed");
  await expect(page.getByRole("button", { name: "Confirm event" })).toHaveCount(0);
});

// A blocked confirmation shows the outstanding arrangements and leaves the status in Planning (AC4).
test("coordinator sees the blocked message when a booking is still pending", async ({ page }) => {
  await stubEventPage(page, "Coordinator");
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/confirm`, (route) =>
    route.fulfill({
      status: 409,
      json: { error: "This event cannot be confirmed yet. 1 venue booking(s) still awaiting approval." },
    }));

  await page.goto(`/events/${EVENT_ID}`);
  await page.getByRole("button", { name: "Confirm event" }).click();

  await expect(page.getByTestId("confirm-blocked-message")).toContainText("awaiting approval");
  await expect(page.getByTestId("event-status-badge")).toHaveText("Planning");
});

// A non-Coordinator never sees the confirm action (AC: only a Coordinator may confirm).
test("an organiser does not see the confirm action", async ({ page }) => {
  await stubEventPage(page, "Organiser");

  await page.goto(`/events/${EVENT_ID}`);

  await expect(page.getByRole("heading", { name: "Annual tech conference" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm event" })).toHaveCount(0);
});
