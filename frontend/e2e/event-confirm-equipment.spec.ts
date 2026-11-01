import { expect, test, type Page } from "./fixtures";

// SCRUM-154 (evidence for SCRUM-136 / D22): confirmation is refused while the event's
// equipment is not fully reserved, and succeeds once Tech Support reserves it. The API
// is mocked here with its real refusal text; the gate itself is proven against the
// database by api/tests/test_equipment_confirmation.py and the SCRUM-153 tests.
const EVENT_ID = "15400000-0000-4000-8000-000000000001";
const API = "http://localhost:5001";
const BLOCKED = "This event cannot be confirmed yet. Technical arrangements are not yet resolved.";

const event = (status = "Planning") => ({
  id: EVENT_ID, title: "Annual tech conference", status, request_status: status,
  organiser_id: 1, coordinator_id: 2, updated_at: "2026-10-01T10:00:00Z",
  last_status_changed_at: "2026-10-01T10:00:00Z", last_status_changed_by: 2,
});

async function asCoordinator(page: Page, equipment: { ready: boolean }) {
  const attempts: number[] = [];
  await page.route("**/session", (route) => route.fulfill({
    json: { user: { id: 2, display_name: "Demo Coordinator", role: "Coordinator" } },
  }));
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill({ json: { event: event() } }));
  await page.route(`${API}/events/${EVENT_ID}/history`, (route) => route.fulfill({ json: { history: [] } }));
  await page.route(`${API}/events/${EVENT_ID}/clarification`, (route) => route.fulfill({ json: { clarification: null } }));
  await page.route(`${API}/events/${EVENT_ID}/confirm`, (route) => {
    attempts.push(Date.now());
    return equipment.ready
      ? route.fulfill({ json: { event: event("Confirmed") } })
      : route.fulfill({ status: 409, json: { error: BLOCKED } });
  });
  await page.goto(`/events/${EVENT_ID}`);
  return attempts;
}

test("confirmation is blocked while equipment is still pending, then succeeds once reserved", async ({ page }) => {
  const equipment = { ready: false };
  const attempts = await asCoordinator(page, equipment);

  await page.getByRole("button", { name: "Confirm event" }).click();
  await expect(page.getByTestId("confirm-blocked-message")).toContainText("Technical arrangements are not yet resolved");
  await expect(page.getByTestId("event-status-badge")).toHaveText("Planning");

  equipment.ready = true; // Tech Support reserves the outstanding equipment.
  await page.getByRole("button", { name: "Confirm event" }).click();
  await expect(page.getByTestId("event-status-badge")).toHaveText("Confirmed");
  expect(attempts).toHaveLength(2);
});
