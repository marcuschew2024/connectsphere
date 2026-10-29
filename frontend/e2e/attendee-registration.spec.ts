import { expect, test, type Page } from "@playwright/test";

const EVENT_ID = "40404040-4040-4040-8040-404040404040";
const API = "http://localhost:5001";
const event = {
  id: EVENT_ID, title: "Campus design workshop", description: "Learn together with your campus community.",
  category: "Workshop", event_datetime: "2099-10-20T06:00:00Z", status: "Confirmed",
  registration_requirements: "Tell us your course and year.",
};
const receipt = { id: "40404040-1111-4111-8111-404040404040", event_id: EVENT_ID,
  status: "Registered", registered_at: "2026-10-29T04:00:00Z" };

async function setup(page: Page, options: {
  role?: string | null;
  unavailable?: string;
  failure?: { status: number; error: string };
  registered?: boolean;
} = {}) {
  const state = { writes: 0, payload: undefined as unknown, registered: options.registered ?? false };
  const offer = () => ({ event, capacity: { capacity: 10, registered_count: 9,
    remaining: 1, is_full: false }, unavailable_reason: options.unavailable ?? null,
    registration: state.registered ? receipt : null });
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: options.role === null ? null : { id: 5, role: options.role ?? "Attendee", display_name: "Demo Attendee" },
  } }));
  await page.route(`${API}/events/registration-offers*`, (route) => route.fulfill({ json: {
    offers: [offer()], page: 1, has_more: false,
  } }));
  await page.route(`${API}/events/${EVENT_ID}/registration-offer`, (route) => route.fulfill({ json: offer() }));
  await page.route(`${API}/events/${EVENT_ID}/registrations`, async (route) => {
    state.writes++;
    state.payload = route.request().postDataJSON();
    if (options.failure) {
      await route.fulfill({ status: options.failure.status, json: { error: options.failure.error } });
    } else {
      state.registered = true;
      await route.fulfill({ status: 201, json: { registration: receipt } });
    }
  });
  await page.route(`${API}/events/registration-confirmations`, (route) => route.fulfill({ json: {
    confirmations: state.registered ? [{ id: 1, event_id: EVENT_ID,
      notification_type: "registration_confirmed", message: "Your place is booked.",
      event: { title: event.title }, created_at: receipt.registered_at }] : [],
  } }));
  return state;
}

test("attendee discovers an event, registers and can reopen the saved confirmation", async ({ page }, testInfo) => {
  const state = await setup(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Browse events", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Browse events" })).toBeVisible();
  await page.getByRole("link", { name: /Campus design workshop/ }).click();
  await expect(page.getByRole("heading", { name: event.title })).toBeVisible();
  await expect(page.getByText("1 place remaining", { exact: true })).toBeVisible();
  await expect(page.getByText(event.registration_requirements, { exact: true })).toBeVisible();
  await page.getByLabel("Registration information (required)").fill("IS, year 2");
  await page.getByRole("button", { name: "Register for event", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Registration confirmed" })).toBeVisible();
  expect(state.payload).toEqual({ information: "IS, year 2" });
  expect(state.writes).toBe(1);
  await expect(page.getByText(receipt.id, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Register for event", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Registration confirmed" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Registration confirmed" })).toBeVisible();
  await page.getByRole("link", { name: "View event →", exact: true }).click();
  await expect(page.getByText(receipt.id, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("registration-confirmed-desktop.png"), fullPage: true });
});

test("required information has a focused accessible correction before any write", async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/events/browse/${EVENT_ID}`);
  await page.getByRole("button", { name: "Register for event", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Provide the required registration information.");
  await expect(page.getByLabel("Registration information (required)")).toBeFocused();
  await expect(page.getByLabel("Registration information (required)")).toHaveAttribute("aria-invalid", "true");
  expect(state.writes).toBe(0);
});

for (const unavailable of ["This event is full. No places are currently available.",
  "Registration has not opened yet.", "Registration has closed.",
  "Registration is only available for confirmed events."]) {
  test(`unavailable event explains why: ${unavailable}`, async ({ page }) => {
    const state = await setup(page, { unavailable });
    await page.goto(`/events/browse/${EVENT_ID}`);
    await expect(page.getByText(unavailable, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Register for event", exact: true })).toHaveCount(0);
    expect(state.writes).toBe(0);
  });
}

for (const failure of [
  { status: 409, error: "This event is full. No places are currently available." },
  { status: 409, error: "You are already registered for this event." },
  { status: 503, error: "Could not confirm the registration change. Refresh the event before retrying." },
]) {
  test(`failed registration preserves information without claiming success (${failure.status}: ${failure.error})`, async ({ page }) => {
    await setup(page, { failure });
    await page.goto(`/events/browse/${EVENT_ID}`);
    await page.getByLabel("Registration information (required)").fill("IS, year 2");
    await page.getByRole("button", { name: "Register for event", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(failure.error);
    await expect(page.getByLabel("Registration information (required)")).toHaveValue("IS, year 2");
    await expect(page.getByRole("heading", { name: "Registration confirmed" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh registration" })).toBeVisible();
  });
}

test("a lost response can recover the saved receipt through refresh", async ({ page }) => {
  const state = await setup(page, { failure: { status: 503, error: "Refresh registration before retrying." } });
  await page.goto(`/events/browse/${EVENT_ID}`);
  await page.getByLabel("Registration information (required)").fill("IS year 2");
  await page.getByRole("button", { name: "Register for event", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  state.registered = true;
  await page.getByRole("button", { name: "Refresh registration" }).click();
  await expect(page.getByRole("heading", { name: "Registration confirmed" })).toBeVisible();
  expect(state.writes).toBe(1);
});

test("guest is directed to sign in and never offered a guest registration form", async ({ page }) => {
  const state = await setup(page, { role: null });
  await page.goto(`/events/browse/${EVENT_ID}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Sign in with an Attendee account");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Register for event", exact: true })).toHaveCount(0);
  expect(state.writes).toBe(0);
});

test("registration form and receipt fit mobile and support keyboard submission", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto(`/events/browse/${EVENT_ID}`);
  await page.getByLabel("Registration information (required)").fill("IS year 2");
  await page.screenshot({ path: testInfo.outputPath("registration-form-mobile.png"), fullPage: true });
  await page.getByLabel("Registration information (required)").press("Tab");
  await page.getByRole("button", { name: "Register for event", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Registration confirmed" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("registration-confirmed-mobile.png"), fullPage: true });
});
