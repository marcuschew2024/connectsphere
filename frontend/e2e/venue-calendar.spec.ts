import { test, expect, type Page } from "./fixtures";

// SCRUM-30 availability calendar against a MOCKED read-contract (venue + bookings), since
// the live endpoints depend on SCRUM-31. Uses a venue open every day 09:00–18:00.
test.use({ timezoneId: "Asia/Singapore" });

const VID = "33333333-3333-4333-8333-333333333333";
const API = "http://localhost:5001";

const VENUE = {
  id: VID, name: "Auditorium A", location: "Level 3, SIS", capacity: 200,
  facilities: [], accessibility: [], supported_layouts: ["Theatre"],
  operating_hours: Object.fromEntries(
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
      .map((d) => [d, { opens: "09:00", closes: "18:00" }]),
  ),
  timezone: "Asia/Singapore", created_by: 3, created_at: "2026-09-01T00:00:00Z",
};

// A confirmed 2–4pm SGT booking for *today*, so it lands in the current week the page shows.
function todaySlotSGT(fromHourUTC: number, toHourUTC: number) {
  const sgt = new Date(Date.now() + 8 * 3600 * 1000);
  const [y, m, d] = [sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate()];
  return {
    start_at: new Date(Date.UTC(y, m, d, fromHourUTC)).toISOString(),
    end_at: new Date(Date.UTC(y, m, d, toHourUTC)).toISOString(),
  };
}
const CONFIRMED = { ...todaySlotSGT(6, 8), status: "Confirmed" }; // 2–4pm SGT
const REQUESTED = { ...todaySlotSGT(2, 3), status: "Requested" }; // 10–11am SGT -> tentative
const BLOCKED = { ...todaySlotSGT(9, 10), status: "Blocked" }; // 5–6pm SGT -> maintenance

async function mockCommon(page: Page, role: string) {
  await page.route("**/notifications", (r) => r.fulfill({ json: { notifications: [] } }));
  await page.route("**/session", (r) => r.fulfill({ json: {
    user: { id: role === "Venue Staff" ? 3 : role === "Coordinator" ? 2 : 1, display_name: `Demo ${role}`, role },
  } }));
  await page.route(`${API}/venues/${VID}`, (r) => r.fulfill({ json: { venue: VENUE } }));
  await page.route(`**/venues/${VID}/bookings**`, (r) => r.fulfill({ json: { bookings: [CONFIRMED, REQUESTED, BLOCKED] } }));
  await page.route(`**/venues/${VID}/unavailability**`, (r) => r.fulfill({ json: { blocks: [] } }));
}

test("coordinator sees the availability calendar with a confirmed slot", async ({ page }) => {
  await mockCommon(page, "Coordinator");
  await page.goto(`/venues/${VID}`);

  await expect(page.getByRole("heading", { name: "Auditorium A" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Availability/ })).toBeVisible();
  // Legend present.
  await expect(page.getByText("Tentative hold")).toBeVisible();
  // Cells reflect each booking state.
  expect(await page.getByLabel(/: Confirmed$/).count()).toBeGreaterThan(0);
  expect(await page.getByLabel(/: Tentative hold$/).count()).toBeGreaterThan(0);
  expect(await page.getByLabel(/: Blocked \(maintenance\)$/).count()).toBeGreaterThan(0);
});

test("the calendar is hidden for non-internal roles (Organiser)", async ({ page }) => {
  await mockCommon(page, "Organiser");
  await page.goto(`/venues/${VID}`);

  await expect(page.getByText("available to Coordinators and Venue Staff")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Availability/ })).toHaveCount(0);
});

test("Venue Staff can create and unblock a venue period", async ({ page }) => {
  await mockCommon(page, "Venue Staff");
  let blocked = false;
  await page.route(`**/venues/${VID}/unavailability**`, async (route) => {
    if (route.request().method() === "POST") {
      blocked = true;
      await route.fulfill({
        json: { block: { id: "block-1", reason: "Maintenance" }, affected_booking_ids: [] },
      });
      return;
    }
    await route.fulfill({
      json: { blocks: blocked ? [{
        id: "block-1",
        reason: "Maintenance",
        start_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
        end_at: new Date(Date.now() + 9 * 3600 * 1000).toISOString(),
      }] : [] },
    });
  });

  await page.goto(`/venues/${VID}`);
  await page.getByLabel("Start").fill("2099-01-01T10:00");
  await page.getByLabel("End").fill("2099-01-01T12:00");
  await page.getByLabel("Reason").selectOption("Maintenance");
  await page.getByRole("button", { name: "Block venue" }).click();

  await expect(page.getByText("Active blocks")).toBeVisible();
  await expect(page.locator("strong").filter({ hasText: /^Maintenance$/ })).toBeVisible();
});
