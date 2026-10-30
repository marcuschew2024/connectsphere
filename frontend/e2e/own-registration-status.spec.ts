import { expect, test, type Page } from "@playwright/test";
import type { OwnRegistration } from "../src/lib/registrations";

const API = "http://localhost:5001";
const EVENT_ID = "44444444-4444-4444-8444-444444444444";
const event = { id: EVENT_ID, title: "Campus community workshop", category: "Workshop",
  event_datetime: "2099-10-20T06:00:00Z", status: "Confirmed" };
const registration: OwnRegistration = { id: "44444444-1111-4111-8111-444444444444", event_id: EVENT_ID,
  status: "Registered", registered_at: "2026-10-29T04:00:00Z", withdrawn_at: null, event };

async function setup(page: Page, role: string | null = "Attendee") {
  const state = { rows: [registration], failure: false, hasMore: false, reads: 0, pages: [] as string[] };
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: role ? { id: 5, role, display_name: "Attendee" } : null,
  } }));
  await page.route(`${API}/events/registration-confirmations`, (route) => route.fulfill({
    json: { confirmations: [] },
  }));
  await page.route(`${API}/events/registrations?*`, (route) => {
    state.reads++;
    const pageNumber = new URL(route.request().url()).searchParams.get("page") ?? "1";
    state.pages.push(pageNumber);
    return route.fulfill(state.failure
      ? { status: 503, json: { error: "Could not load your registrations. Please try again." } }
      : { json: { registrations: state.rows, page: Number(pageNumber), has_more: state.hasMore } });
  });
  await page.route(`${API}/events/${EVENT_ID}/registration-offer`, (route) => route.fulfill({ json: {
    event: { ...event, description: "A campus event", registration_requirements: null },
    registration: state.rows[0], capacity: { capacity: 10, registered_count: 1,
      remaining: 9, is_full: false }, unavailable_reason: null,
  } }));
  return state;
}

test("attendee reaches current registrations from Home and opens an event receipt", async ({ page }, testInfo) => {
  await setup(page);
  await page.goto("/");
  await page.getByRole("link", { name: "My registrations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My registrations" })).toBeVisible();
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();
  await expect(page.getByText(registration.id, { exact: true })).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByText(/20 Oct 2099/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("my-registrations-desktop.png"), fullPage: true });
  await page.getByRole("link", { name: "View event →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Registration confirmed" })).toBeVisible();
  await page.getByRole("link", { name: "My registrations", exact: true }).click();
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();
});

test("fresh reads replace Registered with Withdrawn even when the event is cancelled", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/registrations");
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();
  state.rows = [{ ...registration, status: "Withdrawn", withdrawn_at: "2026-10-29T06:00:00Z",
    event: { ...event, status: "Cancelled" } }];
  await page.getByRole("button", { name: "Refresh registrations" }).click();
  await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByText("Registered", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Withdrawn at", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View event →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Registration withdrawn" })).toBeVisible();
});

test("waiting-list presentation updates to Registered on focus and receipt refresh", async ({ page }) => {
  const state = await setup(page);
  state.rows = [{ ...registration, status: "Waitlisted" }];
  await page.goto("/registrations");
  await expect(page.getByText("Waitlisted", { exact: true })).toBeVisible();
  await expect(page.getByText(/A place has not been confirmed/)).toBeVisible();
  state.rows = [registration];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();
  await expect(page.getByText("Waitlisted", { exact: true })).toHaveCount(0);
  state.rows = [{ ...registration, status: "Waitlisted" }];
  await page.goto(`/events/browse/${EVENT_ID}`);
  await expect(page.getByRole("heading", { name: "Registration waitlisted" })).toBeVisible();
  state.rows = [registration];
  await page.getByRole("button", { name: "Refresh registration", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Registration confirmed" })).toBeVisible();
});

// SCRUM-69: cancelling leaves the registration Registered (D31/D34), so the page must not
// still tell the attendee their place is booked.
test("a registered attendee is told their event was cancelled, not that their place is booked", async ({ page }) => {
  const state = await setup(page);
  const cancelledEvent = { ...event, status: "Cancelled" };
  state.rows = [{ ...registration, event: cancelledEvent }];
  await page.route(`${API}/events/${EVENT_ID}/registration-offer`, (route) => route.fulfill({ json: {
    event: { ...cancelledEvent, description: "A campus event", registration_requirements: null },
    registration: state.rows[0], capacity: { capacity: 10, registered_count: 1, remaining: 9, is_full: false },
    withdrawal_policy: { closes_at: null, unavailable_reason: null }, unavailable_reason: null,
  } }));

  await page.goto("/registrations");
  const card = page.getByRole("list", { name: "Your registrations" }).getByRole("listitem");
  await expect(card.getByText("Event cancelled", { exact: true })).toBeVisible();
  await expect(card.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(card.getByText(/will not take place/)).toBeVisible();
  await expect(card.getByText("Registered", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Your place is booked/)).toHaveCount(0);

  await card.getByRole("link", { name: "View event →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Event cancelled" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Registration confirmed" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Withdraw registration" })).toHaveCount(0);
  await expect(page.getByText(/Withdrawal is allowed/)).toHaveCount(0);
});

test("visible list automatically rechecks status after 30 seconds", async ({ page }) => {
  await page.clock.install();
  const state = await setup(page);
  await page.goto("/registrations");
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();
  state.rows = [{ ...registration, status: "Withdrawn" }];
  await page.clock.fastForward(30000);
  await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
  expect(state.reads).toBeGreaterThanOrEqual(2);
});

test("failed refresh hides old status, explains the error and supports retry", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/registrations");
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();
  state.failure = true;
  await page.getByRole("button", { name: "Refresh registrations" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Could not load your registrations. Please try again.");
  await expect(page.getByText("Registered", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Statuses are up to date.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No registrations yet" })).toHaveCount(0);
  state.failure = false;
  state.rows = [{ ...registration, status: "Withdrawn" }];
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("pagination can return from a page emptied by a concurrent change", async ({ page }) => {
  const state = await setup(page);
  state.hasMore = true;
  await page.goto("/registrations");
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();
  state.rows = [];
  state.hasMore = false;
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No registrations on this page" })).toBeVisible();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  state.rows = [registration];
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
  expect(state.pages).toEqual(["1", "2", "1"]);
});

test("empty list has a useful browse path without claiming a registration", async ({ page }) => {
  const state = await setup(page);
  state.rows = [];
  await page.goto("/registrations");
  await expect(page.getByRole("heading", { name: "No registrations yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse events", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Your registrations" })).toHaveCount(0);
});

for (const role of [null, "Organiser", "Coordinator"]) {
  test(`${role ?? "guest"} cannot load an attendee status list`, async ({ page }) => {
    const state = await setup(page, role);
    await page.goto("/registrations");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Sign in with an Attendee account");
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    expect(state.reads).toBe(0);
  });
}

test("mobile cards wrap long titles and references and refresh by keyboard", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page);
  state.rows = [{ ...registration, event: { ...event, title: "Campus".repeat(25) } }];
  await page.goto("/registrations");
  await expect(page.getByText("Registered", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh registrations" }).focus();
  state.rows = [{ ...state.rows[0], status: "Withdrawn" }];
  await page.keyboard.press("Enter");
  await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("my-registrations-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Registrations", exact: true })).toHaveAttribute("aria-current", "page");
});
