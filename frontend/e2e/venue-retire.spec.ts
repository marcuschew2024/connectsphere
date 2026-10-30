import { test, expect, type Page } from "@playwright/test";
import type { Venue } from "../src/lib/venues";

// SCRUM-26: Venue Staff retire a venue. The API is mocked; the retirement rules and the
// database guard are covered by the API's unit, route and acceptance tests.
test.use({ timezoneId: "Asia/Singapore" });

const API = "http://localhost:5001";
const VID = "26262626-2626-4262-8262-262626262626";
const RETIRED_AT = "2026-10-31T02:30:00+00:00";

const VENUE: Venue = {
  id: VID, name: "Old Lecture Theatre", location: "Block C, Level 1", capacity: 150,
  facilities: ["Projector"], accessibility: [], supported_layouts: ["Theatre"],
  operating_hours: Object.fromEntries(
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
      .map((day) => [day, { opens: "09:00", closes: "18:00" }]),
  ) as Venue["operating_hours"],
  timezone: "Asia/Singapore", created_by: 3, created_at: "2026-09-01T00:00:00Z", revision: 1,
  is_retired: false, retired_at: null, retired_by: null,
};
const RETIRED: Venue = { ...VENUE, is_retired: true, retired_at: RETIRED_AT, retired_by: 3, revision: 2 };

async function mockVenuePage(page: Page, role: string, venue = VENUE) {
  const state = { retireBodies: [] as unknown[], refusal: "" };
  await page.route("**/notifications", (r) => r.fulfill({ json: { notifications: [] } }));
  await page.route("**/session", (r) => r.fulfill({ json: {
    user: { id: role === "Venue Staff" ? 3 : 2, display_name: `Demo ${role}`, role },
  } }));
  await page.route(`${API}/venues/${VID}`, (r) => r.fulfill({ json: {
    venue: venue.is_retired ? { ...venue, retired_by_name: "Demo Venue Staff" } : venue,
  } }));
  await page.route(`**/venues/${VID}/bookings**`, (r) => r.fulfill({ json: { bookings: [] } }));
  await page.route(`**/venues/${VID}/unavailability**`, (r) => r.fulfill({ json: { blocks: [] } }));
  await page.route(`${API}/venues/${VID}/retire`, (r) => {
    state.retireBodies.push(r.request().postDataJSON());
    return state.refusal
      ? r.fulfill({ status: 409, json: { error: state.refusal } })
      : r.fulfill({ json: {
        venue: { ...RETIRED, retired_by_name: "Demo Venue Staff" }, kept_confirmed_bookings: 2,
      } });
  });
  return state;
}

test("venue staff retire a venue and see who retired it and what was kept", async ({ page }, testInfo) => {
  const state = await mockVenuePage(page, "Venue Staff");
  await page.goto(`/venues/${VID}`);

  await page.getByText("Retire venue", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Retire this venue" })).toBeVisible();
  await expect(page.getByText(/confirmed bookings and history are kept/)).toBeVisible();
  await page.getByRole("button", { name: "Continue to retirement" }).click();
  await expect(page.getByText("Retiring a venue cannot be undone. Continue?")).toBeVisible();
  await page.getByRole("button", { name: "Confirm retirement" }).click();

  const banner = page.getByRole("status").filter({ hasText: "Venue retired" });
  await expect(banner).toContainText("Retired 31 Oct 2026, 10:30 am (Singapore) by Demo Venue Staff");
  await expect(banner).toContainText("no longer offered for new bookings");
  await expect(banner).toContainText("2 upcoming confirmed bookings were kept.");
  await expect(page.getByText("Retire venue", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Availability/ })).toBeVisible();
  expect(state.retireBodies).toEqual([{}]);
  await page.screenshot({ path: testInfo.outputPath("venue-retired.png"), fullPage: true });
});

test("keeping the venue at the confirm step sends nothing", async ({ page }) => {
  const state = await mockVenuePage(page, "Venue Staff");
  await page.goto(`/venues/${VID}`);
  await page.getByText("Retire venue", { exact: true }).click();
  await page.getByRole("button", { name: "Continue to retirement" }).click();
  await page.getByRole("button", { name: "Keep venue" }).click();

  await expect(page.getByRole("button", { name: "Continue to retirement" })).toBeVisible();
  await expect(page.getByText("Venue retired")).toHaveCount(0);
  expect(state.retireBodies).toEqual([]);
});

test("a refusal explains what to do and leaves the venue active", async ({ page }) => {
  const state = await mockVenuePage(page, "Venue Staff");
  state.refusal = "Decide the 2 outstanding booking requests for this venue before retiring it.";
  await page.goto(`/venues/${VID}`);
  await page.getByText("Retire venue", { exact: true }).click();
  await page.getByRole("button", { name: "Continue to retirement" }).click();
  await page.getByRole("button", { name: "Confirm retirement" }).click();

  await expect(page.getByTestId("retire-error-message")).toHaveText(state.refusal);
  await expect(page.getByText("Venue retired")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue to retirement" })).toBeVisible();
});

test("coordinators cannot retire a venue", async ({ page }) => {
  await mockVenuePage(page, "Coordinator");
  await page.goto(`/venues/${VID}`);
  await expect(page.getByRole("heading", { name: "Old Lecture Theatre" })).toBeVisible();
  await expect(page.getByText("Retire venue", { exact: true })).toHaveCount(0);
});

for (const role of ["Venue Staff", "Coordinator"]) {
  test(`${role} sees a retired venue's record with its retirement`, async ({ page }) => {
    await mockVenuePage(page, role, RETIRED);
    await page.goto(`/venues/${VID}`);
    const banner = page.getByRole("status").filter({ hasText: "Venue retired" });
    await expect(banner).toContainText("Retired 31 Oct 2026, 10:30 am (Singapore) by Demo Venue Staff");
    await expect(page.getByText("Retire venue", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Availability/ })).toBeVisible();
  });
}

test("the catalogue keeps retired venues for staff but offers no edit", async ({ page }) => {
  await mockVenuePage(page, "Venue Staff");
  await page.route("**/venues/filter-options", (r) => r.fulfill({ json: { facilities: [], accessibility: [] } }));
  await page.route(`${API}/venues?*`, (r) => r.fulfill({ json: { venues: [
    { ...VENUE, id: "active", name: "Active hall" },
    { ...RETIRED, id: "retired", name: "Retired hall" },
  ], has_more: false } }));
  await page.goto("/venues");

  const retired = page.getByRole("listitem").filter({ hasText: "Retired hall" });
  const active = page.getByRole("listitem").filter({ hasText: "Active hall" });
  await expect(retired.getByText("Unavailable — retired venue")).toBeVisible();
  await expect(retired.getByRole("link", { name: "Edit venue" })).toHaveCount(0);
  await expect(active.getByRole("link", { name: "Edit venue" })).toBeVisible();
});

test("a retired venue's edit page explains it is read-only", async ({ page }) => {
  await mockVenuePage(page, "Venue Staff", RETIRED);
  await page.goto(`/venues/${VID}/edit`);
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "This venue is retired. Its details are kept for history and cannot be edited.",
  );
  await expect(page.getByRole("button", { name: /Save/ })).toHaveCount(0);
});

test("the retire panel fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await mockVenuePage(page, "Venue Staff");
  await page.goto(`/venues/${VID}`);
  await page.getByText("Retire venue", { exact: true }).click();
  await page.getByRole("button", { name: "Continue to retirement" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Confirm retirement" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
