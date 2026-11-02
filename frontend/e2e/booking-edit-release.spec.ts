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
  // Layout, facilities and accessibility are checkbox groups, matching the request form.
  // The booking is stored as Theatre, so switching layout means unticking it.
  await page.getByRole("checkbox", { name: "Theatre", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Classroom", exact: true }).check();
  await page.getByRole("checkbox", { name: "Projector", exact: true }).check();
  await page.getByRole("button", { name: "Save booking change" }).click();
  await expect(page).toHaveURL(/\/events\/event-1$/);
  expect(writes).toBe(1);
  expect(stored).toMatchObject({ venue_id: "venue-2", expected_attendance: 30, layout: "Classroom",
    start_at: "2099-10-21T06:00:00.000Z", end_at: "2099-10-21T08:00:00.000Z", special_requirements: "Projector" });
  await page.goto(`/venues/bookings/${id}/edit`);
  await expect(page.getByRole("combobox", { name: /^Venue/ })).toHaveValue("venue-2");
  await expect(page.getByRole("checkbox", { name: "Projector", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Classroom", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Theatre", exact: true })).not.toBeChecked();
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

// D63: layout, facilities and accessibility are checkbox groups here, each with an Other
// box that reveals a free-text list. Unticking Other must discard what was typed, so a
// Coordinator who changes their mind cannot save a requirement they can no longer see.
const CUSTOM = [
  { group: "Layout", box: "Layout Other", field: "Other layouts", value: "Thrust stage" },
  { group: "Facilities", box: "Facilities Other", field: "Other facilities", value: "Rehearsal piano" },
  { group: "Accessibility", box: "Accessibility Other", field: "Other accessibility features", value: "Quiet room" },
];

for (const { group, box, field, value } of CUSTOM) {
  test(`unticking ${group} Other discards the custom entry instead of keeping it hidden`, async ({ page }) => {
    await page.route(`**/venues/bookings/${id}`, route => route.fulfill({ json: { booking } }));
    await page.goto(`/venues/bookings/${id}/edit`);

    await page.getByRole("checkbox", { name: box, exact: true }).check();
    await page.getByRole("textbox", { name: field, exact: true }).fill(value);
    await page.getByRole("textbox", { name: field, exact: true }).press("Enter");
    await expect(page.getByRole("button", { name: `Remove ${value}` })).toBeVisible();

    await page.getByRole("checkbox", { name: box, exact: true }).uncheck();
    await expect(page.getByRole("textbox", { name: field, exact: true })).toHaveCount(0);

    // Re-ticking shows an empty list: the entry was discarded, not merely hidden behind
    // the checkbox and still waiting to be saved.
    await page.getByRole("checkbox", { name: box, exact: true }).check();
    await expect(page.getByRole("textbox", { name: field, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Remove ${value}` })).toHaveCount(0);
  });
}

test("a custom entry in every group reaches the API alongside the ticked presets", async ({ page }) => {
  let saved: Record<string, unknown> | null = null;
  await page.route(`**/venues/bookings/${id}`, async route => {
    if (route.request().method() === "PATCH") saved = route.request().postDataJSON();
    await route.fulfill({ json: { booking } });
  });
  await page.route("**/events/event-1", route => route.fulfill({ status: 503, json: { error: "Event view is outside this booking-edit scenario" } }));
  await page.goto(`/venues/bookings/${id}/edit`);

  await page.getByRole("checkbox", { name: "Projector", exact: true }).check();
  await page.getByRole("checkbox", { name: "Ramp", exact: true }).check();
  for (const { box, field, value } of CUSTOM) {
    await page.getByRole("checkbox", { name: box, exact: true }).check();
    await page.getByRole("textbox", { name: field, exact: true }).fill(value);
    await page.getByRole("textbox", { name: field, exact: true }).press("Enter");
  }
  await page.getByRole("button", { name: "Save booking change" }).click();

  await expect(page).toHaveURL(/\/events\/event-1$/);
  // Facilities and accessibility share one stored column, so their customs join the same
  // list; a layout custom must stay out of it.
  const body = saved as unknown as { layout: string; special_requirements: string };
  expect(body.layout).toBe("Theatre, Thrust stage");
  expect(body.special_requirements.split(", ").sort())
    .toEqual(["Projector", "Quiet room", "Ramp", "Rehearsal piano"]);
});
