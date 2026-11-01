import { expect, test } from "./fixtures";
test.use({ timezoneId: "Asia/Singapore" });
const id = "22222222-2222-4222-8222-222222222222";
const booking = { id, event_id: "event-1", venue_id: "venue-1", requested_by: 2, status: "Requested",
  start_at: "2099-10-20T06:00:00Z", end_at: "2099-10-20T08:00:00Z", expected_attendance: 20,
  layout: "Theatre", special_requirements: null };
test.beforeEach(async ({ page }) => {
  await page.route("**/session", route => route.fulfill({ json: { user: { id: 2, role: "Coordinator", display_name: "Coordinator A" } } }));
  await page.route("**/venues?page=1", route => route.fulfill({ json: { venues: [
    { id: "venue-1", name: "Hall", capacity: 100 }, { id: "venue-2", name: "Room", capacity: 40 },
  ] } }));
});
test("Coordinator changes one Requested booking and the changes survive reopening", async ({ page }) => {
  let stored = { ...booking }; let writes = 0;
  await page.route(`**/venues/bookings/${id}`, async route => {
    if (route.request().method() === "PATCH") { writes++; stored = { ...stored, ...route.request().postDataJSON() }; }
    await route.fulfill({ json: { booking: stored } });
  });
  await page.route("**/events/event-1", route => route.fulfill({ status: 503, json: { error: "Event view is outside this booking-edit scenario" } }));
  await page.goto(`/venues/bookings/${id}/edit`);
  await page.getByRole("combobox", { name: /^Venue/ }).selectOption("venue-2");
  await page.getByLabel("Start", { exact: true }).fill("2099-10-21T14:00");
  await page.getByLabel("End", { exact: true }).fill("2099-10-21T16:00");
  await page.getByLabel("Expected attendance").fill("30");
  await page.getByLabel("Layout", { exact: true }).fill("Classroom");
  await page.getByLabel("Special requirements").fill("Projector");
  await page.getByRole("button", { name: "Save booking change" }).click();
  await expect(page).toHaveURL(/\/events\/event-1$/);
  expect(writes).toBe(1);
  expect(stored).toMatchObject({ venue_id: "venue-2", expected_attendance: 30, layout: "Classroom",
    start_at: "2099-10-21T06:00:00.000Z", end_at: "2099-10-21T08:00:00.000Z", special_requirements: "Projector" });
  await page.goto(`/venues/bookings/${id}/edit`);
  await expect(page.getByRole("combobox", { name: /^Venue/ })).toHaveValue("venue-2");
  await expect(page.getByLabel("Special requirements")).toHaveValue("Projector");
});
for (const scenario of [{ status: "Confirmed", requested_by: 2 }, { status: "Requested", requested_by: 7 }]) {
  test(`direct edit URL is read-only for ${scenario.status} booking owned by ${scenario.requested_by}`, async ({ page }) => {
    let writes = 0;
    await page.route(`**/venues/bookings/${id}`, route => {
      if (route.request().method() === "PATCH") writes++;
      return route.fulfill({ json: { booking: { ...booking, ...scenario } } });
    });
    await page.goto(`/venues/bookings/${id}/edit`);
    await expect(page.getByText(/This booking is read-only/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save booking change" })).toHaveCount(0);
    expect(writes).toBe(0);
  });
}
