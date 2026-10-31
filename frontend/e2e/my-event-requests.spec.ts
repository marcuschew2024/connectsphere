import { expect, test, type Page } from "@playwright/test";

// SCRUM-19: an Organiser can track the requests they have submitted, seeing only the
// customer-facing lifecycle status (never internal review sub-states), and reach the
// detail page from a list — the gap found in the Sprint 4 walkthrough.
test.use({ timezoneId: "Asia/Singapore" });

const API = "http://localhost:5001";
const PLANNING_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONFIRMED_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DRAFT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const base = {
  description: "Bring the campus together.", purpose: "Share ideas", category: "Workshop",
  event_datetime: "2099-10-20T06:00:00Z", expected_attendance: 50, organiser_id: 1,
  coordinator_id: null, updated_at: "2026-10-30T06:00:00Z",
};
// The API projects an Organiser's status to the public lifecycle, so a Submitted request
// arrives here as "Planning" (request_status keeps the internal value, never shown).
const planning = { ...base, id: PLANNING_ID, title: "An evening of ideas", status: "Planning", request_status: "Submitted" };
const confirmed = { ...base, id: CONFIRMED_ID, title: "Alumni mixer", status: "Confirmed", request_status: "Confirmed" };
const draft = { ...base, id: DRAFT_ID, title: "Half-formed idea", status: "Draft", request_status: "Draft" };

async function session(page: Page, role: string | null = "Organiser") {
  await page.route("**/notifications", (route) => route.fulfill({ json: { notifications: [] } }));
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: role ? { id: 1, display_name: `Demo ${role}`, role } : null,
  } }));
}

test("organiser reaches the list from Home, sees public status, and opens a request", async ({ page }) => {
  await session(page);
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events: [planning, confirmed, draft] } }));
  await page.route(`${API}/events/${PLANNING_ID}`, (route) => route.fulfill({ json: { event: planning } }));

  await page.goto("/");
  await page.getByRole("link", { name: "My event requests" }).click();
  await expect(page).toHaveURL(/\/events\/mine$/);

  // Both submitted requests show; the draft is filtered out (it has its own page).
  await expect(page.getByRole("heading", { name: "An evening of ideas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alumni mixer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Half-formed idea" })).toHaveCount(0);

  // The internal sub-state is never exposed — only the projected "Planning" badge.
  const badges = page.getByTestId("event-status-badge");
  await expect(badges.filter({ hasText: "Planning" })).toBeVisible();
  await expect(badges.filter({ hasText: "Confirmed" })).toBeVisible();
  await expect(badges.filter({ hasText: "Submitted" })).toHaveCount(0);

  await page.getByRole("link", { name: /Open request/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/events/${PLANNING_ID}$`));
});

test("empty list points the organiser at creating a request", async ({ page }) => {
  await session(page);
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events: [] } }));
  await page.goto("/events/mine");
  await expect(page.getByRole("heading", { name: "No submitted requests yet." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create your first request" })).toHaveAttribute("href", "/events/new");
});

test("load failure offers a working retry", async ({ page }) => {
  await session(page);
  let attempts = 0;
  await page.route(`${API}/events`, (route) => {
    attempts++;
    return route.fulfill(attempts === 1
      ? { status: 503, json: { error: "Could not load your event requests." } }
      : { json: { events: [planning] } });
  });
  await page.goto("/events/mine");
  await expect(page.locator("main").getByRole("alert")).toHaveText("Could not load your event requests.");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "An evening of ideas" })).toBeVisible();
});

for (const role of ["Coordinator", "Venue Staff", "Tech Support", "Attendee", null]) {
  test(`the list stays closed and fetches nothing for ${role ?? "no user"}`, async ({ page }) => {
    await session(page, role);
    let reads = 0;
    await page.route(`${API}/events`, (route) => { reads++; return route.fulfill({ json: { events: [] } }); });
    await page.goto("/events/mine");
    await expect(page.locator("main").getByRole("alert")).toHaveText("Only Organisers can view their submitted requests here.");
    expect(reads).toBe(0);
  });
}
