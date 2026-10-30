import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:5001";
const EVENT_ID = "43434343-4343-4343-8343-434343434343";
const event = { id: EVENT_ID, title: "Campus withdrawal workshop", description: "Learn together.",
  category: "Workshop", event_datetime: "2099-10-20T06:00:00Z", status: "Confirmed",
  registration_requirements: null };
const registered = { id: "43434343-1111-4111-8111-434343434343", event_id: EVENT_ID,
  status: "Registered", registered_at: "2026-10-29T04:00:00Z", withdrawn_at: null as string | null };

async function setup(page: Page, options: { unavailable?: string; failure?: boolean; role?: string } = {}) {
  const state = { receipt: { ...registered }, writes: 0, fail: options.failure ?? false };
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: 5, role: options.role ?? "Attendee", display_name: "Campus attendee" },
  } }));
  await page.route(`${API}/events/${EVENT_ID}/registration-offer`, (route) => route.fulfill({ json: {
    event, registration: state.receipt, unavailable_reason: null,
    capacity: { capacity: 1, registered_count: state.receipt.status === "Registered" ? 1 : 0,
      remaining: state.receipt.status === "Registered" ? 0 : 1, is_full: state.receipt.status === "Registered" },
    withdrawal_policy: { closes_at: "2099-10-19T06:00:00Z", unavailable_reason: options.unavailable ?? null },
  } }));
  await page.route(`${API}/events/${EVENT_ID}/registrations/withdraw`, async (route) => {
    state.writes++;
    expect(route.request().postDataJSON()).toEqual({});
    expect(route.request().method()).toBe("POST");
    if (state.fail) return route.fulfill({ status: 503, json: { error: "Could not confirm the registration change. Refresh the event before retrying." } });
    state.receipt = { ...registered, status: "Withdrawn", withdrawn_at: "2026-10-30T06:00:00Z" };
    return route.fulfill({ json: { registration: state.receipt } });
  });
  await page.route(`${API}/events/registrations?*`, (route) => route.fulfill({ json: {
    registrations: [{ ...state.receipt, event }], page: 1, has_more: false,
  } }));
  await page.route(`${API}/events/registration-confirmations`, (route) => route.fulfill({ json: {
    confirmations: state.receipt.status === "Withdrawn" ? [{ id: 1, event_id: EVENT_ID,
      notification_type: "registration_withdrawn", message: "Your registration has been withdrawn. Your place has been released.",
      created_at: state.receipt.withdrawn_at, event: { title: event.title } }] : [],
  } }));
  return state;
}

test("attendee confirms withdrawal, sees its timestamp and reopens the saved status", async ({ page }, testInfo) => {
  const state = await setup(page);
  await page.goto("/registrations");
  await page.getByRole("link", { name: "View event →", exact: true }).click();
  await expect(page.getByText(/Withdrawal closes/)).toContainText("19 Oct 2099");
  await page.getByRole("button", { name: "Withdraw registration", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Withdraw your registration?" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Keep registration" })).toBeFocused();
  expect(state.writes).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("withdrawal-confirm-desktop.png"), fullPage: true, animations: "disabled" });
  await dialog.getByRole("button", { name: "Confirm withdrawal" }).click();
  await expect(page.getByRole("heading", { name: "Registration withdrawn" })).toBeVisible();
  await expect(page.getByText("Withdrawn at", { exact: true })).toBeVisible();
  await expect(page.getByText(/30 Oct 2026/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Withdraw registration", exact: true })).toHaveCount(0);
  expect(state.writes).toBe(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Registration withdrawn" })).toBeVisible();
  await page.getByRole("link", { name: "My registrations", exact: true }).click();
  await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Registration withdrawn", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View event →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Registration withdrawn" })).toBeVisible();
});

test("cancelling the confirmation leaves the place booked and sends no write", async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/events/browse/${EVENT_ID}`);
  await page.getByRole("button", { name: "Withdraw registration", exact: true }).click();
  await page.getByRole("button", { name: "Keep registration" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Registration confirmed" })).toBeVisible();
  expect(state.writes).toBe(0);
});

for (const unavailable of ["The organiser’s withdrawal deadline has passed.",
  "Withdrawal is closed because the event has started.",
  "Withdrawal is only available before an active event starts."]) {
  test(`closed withdrawal explains the condition: ${unavailable}`, async ({ page }) => {
    const state = await setup(page, { unavailable });
    await page.goto(`/events/browse/${EVENT_ID}`);
    await expect(page.getByText(unavailable, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Withdraw registration", exact: true })).toHaveCount(0);
    expect(state.writes).toBe(0);
  });
}

test("an uncertain withdrawal response requires refresh and recovers a committed receipt", async ({ page }) => {
  const state = await setup(page, { failure: true });
  await page.goto(`/events/browse/${EVENT_ID}`);
  await page.getByRole("button", { name: "Withdraw registration", exact: true }).click();
  await page.getByRole("button", { name: "Confirm withdrawal" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Refresh");
  await expect(page.getByRole("button", { name: "Confirm withdrawal" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Registration withdrawn" })).toHaveCount(0);
  state.receipt = { ...registered, status: "Withdrawn", withdrawn_at: "2026-10-30T06:00:00Z" };
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).first().click();
  await page.getByRole("button", { name: "Refresh registration", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Registration withdrawn" })).toBeVisible();
  expect(state.writes).toBe(1);
});

test("mobile withdrawal supports keyboard confirmation without overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto(`/events/browse/${EVENT_ID}`);
  await page.getByRole("button", { name: "Withdraw registration", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("withdrawal-confirm-mobile.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Confirm withdrawal" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Registration withdrawn" })).toBeVisible();
});

test("organiser sets one optional cutoff in Singapore time and sees a locked policy", async ({ page }, testInfo) => {
  await setup(page, { role: "Organiser" });
  let cutoff: string | null = null;
  let locked = false;
  await page.route(`${API}/events/${EVENT_ID}`, (route) => route.fulfill({ json: {
    event: { ...event, organiser_id: 1, coordinator_id: 2, registration_capacity: 10,
      registered_count: 0, withdrawal_closes_at: null, request_status: "Confirmed",
      updated_at: "2026-10-30T06:00:00Z", purpose: "Campus learning", expected_attendance: 10 },
  } }));
  await page.route(`${API}/events/${EVENT_ID}/history`, (route) => route.fulfill({ json: { history: [] } }));
  await page.route(`${API}/events/${EVENT_ID}/clarification`, (route) => route.fulfill({ json: { clarification: null } }));
  await page.route(`${API}/events/${EVENT_ID}/change-requests`, (route) => route.fulfill({ json: { change_requests: [] } }));
  await page.route(`${API}/venues/bookings/event/${EVENT_ID}`, (route) => route.fulfill({ json: { bookings: [] } }));
  await page.route(`${API}/events/${EVENT_ID}/withdrawal-policy`, (route) => {
    if (route.request().method() === "PUT") {
      expect(route.request().postDataJSON()).toEqual({ closes_at: "2099-10-19T06:00:00.000Z" });
      cutoff = "2099-10-19T06:00:00Z";
    }
    return route.fulfill({ json: { withdrawal_policy: { closes_at: cutoff, can_edit: !locked } } });
  });
  await page.goto(`/events/${EVENT_ID}`);
  await page.getByLabel("Withdrawal deadline (Singapore time, optional)").fill("2099-10-19T14:00");
  await page.getByRole("button", { name: "Save withdrawal conditions" }).click();
  await expect(page.getByText("Withdrawal conditions saved.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("withdrawal-policy-desktop.png"), fullPage: true, animations: "disabled" });
  locked = true;
  await page.reload();
  await expect(page.getByText(/Conditions are locked/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save withdrawal conditions" })).toHaveCount(0);
});
