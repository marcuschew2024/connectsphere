import { expect, test } from "@playwright/test";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const API_ORIGIN = "http://localhost:5001";

const statuses = [
  ["Planning", "bg-blue-500/20"],
  ["Confirmed", "bg-emerald-500/20"],
  ["Completed", "bg-violet-500/20"],
  ["Rejected", "bg-red-500/20"],
  ["Cancelled", "bg-slate-500/20"],
] as const;

// Each canonical visible state renders with its designated badge style.
for (const [status, style] of statuses) {
  test(`${status} event status uses its distinct badge style`, async ({ page }) => {
    await page.route("**/session", (route) => route.fulfill({ json: {
      user: { id: 1, display_name: "Demo Organiser", role: "Organiser" },
    } }));
    await page.route(`${API_ORIGIN}/events/${EVENT_ID}`, (route) => route.fulfill({ json: {
      event: {
        id: EVENT_ID,
        title: "Status styling check",
        status,
        request_status: status,
        organiser_id: 1,
        coordinator_id: 2,
        updated_at: "2026-09-27T10:00:00Z",
        last_status_changed_at: "2026-09-27T10:00:00Z",
        last_status_changed_by: 2,
      },
    } }));
    await page.route(`${API_ORIGIN}/events/${EVENT_ID}/history`, (route) =>
      route.fulfill({ json: { history: [] } }));
    await page.route(`${API_ORIGIN}/events/${EVENT_ID}/clarification`, (route) =>
      route.fulfill({ json: { clarification: null } }));

    await page.goto(`/events/${EVENT_ID}`);

    const badge = page.getByTestId("event-status-badge");
    await expect(badge).toHaveText(status);
    await expect(badge).toHaveClass(new RegExp(style.replace("/", "\\/")));
  });
}

// Unexpected values take the neutral fallback style rather than inheriting a wrong status color.
test("unknown event status uses the neutral badge fallback", async ({ page }) => {
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: 1, display_name: "Demo Organiser", role: "Organiser" },
  } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}`, (route) => route.fulfill({ json: {
    event: {
      id: EVENT_ID,
      title: "Unknown status check",
      status: "Unexpected",
      request_status: "Unexpected",
      organiser_id: 1,
      coordinator_id: 2,
      updated_at: "2026-09-27T10:00:00Z",
      last_status_changed_at: "2026-09-27T10:00:00Z",
      last_status_changed_by: 2,
    },
  } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/history`, (route) =>
    route.fulfill({ json: { history: [] } }));
  await page.route(`${API_ORIGIN}/events/${EVENT_ID}/clarification`, (route) =>
    route.fulfill({ json: { clarification: null } }));

  await page.goto(`/events/${EVENT_ID}`);

  const badge = page.getByTestId("event-status-badge");
  await expect(badge).toHaveText("Unexpected");
  await expect(badge).toHaveClass(/bg-slate-500\/20/);
});