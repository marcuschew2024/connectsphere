import { expect, test, type Page } from "./fixtures";

const API = "http://localhost:5001";
const ID = "45454545-4545-4545-8545-454545454545";
const path = `/events/${ID}/registrations`;
const row = { id: "registration-1", reference: "REG-001", status: "Registered",
  registered_at: "2026-10-31T04:30:00Z", withdrawn_at: null as string | null,
  attendee: { display_name: "Alex Tan" } };

async function setup(page: Page, role = "Organiser") {
  const state = { rows: [row], registered: 27, waitlisted: 0, withdrawn: 0,
    capacity: 30 as number | null, status: "Confirmed", failure: 0, reads: 0, queries: [] as string[] };
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: 1, role, display_name: "Organiser" },
  } }));
  await page.route(`${API}${path}?*`, (route) => {
    state.reads++;
    const query = new URL(route.request().url()).searchParams;
    state.queries.push(query.toString());
    return route.fulfill(state.failure ? { status: state.failure, json: {
      error: state.failure === 403 ? "Only the event's Organiser and assigned Coordinator can view registrations."
        : "Could not load event registrations. Please try again.",
    } } : { json: {
      event: { id: ID, reference: "EVT-001", title: "Campus community workshop",
        event_datetime: "2099-10-20T06:00:00Z", status: state.status },
      registrations: state.rows, capacity: state.capacity,
      counts: { registered_count: state.registered, waitlisted_count: state.waitlisted,
        withdrawn_count: state.withdrawn }, page: Number(query.get("page")),
      has_more: query.get("page") === "1" && !query.get("status"),
    } });
  });
  return state;
}

for (const role of ["Organiser", "Coordinator"]) {
  test(`${role} sees names, references and event-wide totals across pages and filters`, async ({ page }) => {
    const state = await setup(page, role);
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Campus community workshop" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Alex Tan/ })).toContainText("REG-001");
    await expect(page.getByText("27 / 30", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
    await expect(page.getByText("27 / 30", { exact: true })).toBeVisible();
    state.rows = [{ ...row, status: "Withdrawn", withdrawn_at: "2026-10-31T05:00:00Z" }];
    await page.getByLabel("Registration status", { exact: true }).selectOption("Withdrawn");
    await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /Alex Tan/ })).toContainText("Withdrawn");
    expect(state.queries).toContain("page=2");
    expect(state.queries).toContain("page=1&status=Withdrawn");
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Back to event" })).toHaveAttribute("href", `/events/${ID}`);
  });
}

test("withdrawal and permission loss replace stale private data on refresh", async ({ page }) => {
  const state = await setup(page);
  await page.goto(path);
  await expect(page.getByRole("row", { name: /Alex Tan/ })).toBeVisible();
  state.rows = [{ ...row, status: "Withdrawn", withdrawn_at: "2026-10-31T05:00:00Z" }];
  state.registered = 26; state.withdrawn = 1;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("row", { name: /Alex Tan/ })).toContainText("Withdrawn");
  await expect(page.getByText("26 / 30", { exact: true })).toBeVisible();
  state.failure = 403;
  await page.getByRole("button", { name: "Refresh registrations" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("assigned Coordinator");
  await expect(page.getByText("Alex Tan")).toHaveCount(0);
  await expect(page.getByText("26 / 30", { exact: true })).toHaveCount(0);
});

test("failed request supports retry and never presents an empty roster as success", async ({ page }) => {
  const state = await setup(page);
  state.failure = 503;
  await page.goto(path);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not load");
  await expect(page.getByText(/No registrations yet/)).toHaveCount(0);
  state.failure = 0;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("row", { name: /Alex Tan/ })).toBeVisible();
});

test("empty roster distinguishes unset capacity and a waitlist filter", async ({ page }) => {
  const state = await setup(page);
  state.rows = []; state.capacity = null; state.registered = 0;
  await page.goto(path);
  await expect(page.getByText("Capacity not set", { exact: true })).toBeVisible();
  await expect(page.getByText(/No registrations yet/)).toBeVisible();
  await page.getByLabel("Registration status", { exact: true }).selectOption("Waitlisted");
  await expect(page.getByText("No waitlisted registrations on this page.")).toBeVisible();
  await expect(page.getByText(/Waiting-list signup is not currently available/)).toBeVisible();
});

test("waitlisted counts remain separate from registered capacity", async ({ page }) => {
  const state = await setup(page);
  state.waitlisted = 4;
  state.rows = [{ ...row, status: "Waitlisted" }];
  await page.goto(path);
  await expect(page.getByRole("row", { name: /Alex Tan/ })).toContainText("Waitlisted");
  await expect(page.getByText("27 / 30", { exact: true })).toBeVisible();
  await expect(page.locator("dl div").filter({ has: page.getByText("Waitlisted", { exact: true }) })).toContainText("4");
  await expect(page.locator("dl div").filter({ has: page.getByText("Places remaining", { exact: true }) })).toContainText("3");
});

test("cancelled roster is historical and works on a narrow screen", async ({ page }, testInfo) => {
  const state = await setup(page);
  state.status = "Cancelled";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
  await expect(page.getByText(/This event was cancelled/)).toBeVisible();
  await expect(page.getByRole("row", { name: /Alex Tan/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("roster-mobile.png"), fullPage: true });
});

for (const role of ["Attendee", "Venue Staff", "Tech Support", "Safety Officer", "Event Coordinator Lead"]) {
  test(`${role} cannot fetch the roster through its page`, async ({ page }) => {
    const state = await setup(page, role);
    await page.goto(path);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("assigned Coordinator");
    expect(state.reads).toBe(0);
  });
}
