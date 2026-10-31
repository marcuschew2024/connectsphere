import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:5001";
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const VENUE_ID = "33333333-3333-4333-8333-333333333333";

const suitabilityFlags = [
  "Expected attendance (150 pax) exceeds venue capacity (100 pax) by 50 pax.",
  "Requested layout(s) not listed in the venue's supported layouts (Theatre): Banquet.",
  "Missing required facility feature(s): Projector.",
  "Missing required accessibility feature(s): Wheelchair.",
];

async function configureSuitabilityScenario(
  page: Page,
  venue: Record<string, unknown>,
  event: Record<string, unknown>,
  flags: string[],
) {
  await page.route(`${API}/events`, (route) => route.fulfill({
    json: { events: [event] },
  }));
  await page.route(`${API}/venues?*`, (route) => route.fulfill({
    json: { venues: [venue], page: 1, has_more: false },
  }));
  await page.route(`${API}/venues/${VENUE_ID}/suitability/${EVENT_ID}`, async (route) => {
    const response = {
      suitability: {
        is_suitable: flags.length === 0,
        flags,
        checked_rules_count: 4,
      },
      event_id: EVENT_ID,
      venue_id: VENUE_ID,
    };
    await route.fulfill({ json: response });
    expect(response.suitability.is_suitable).toBe(flags.length === 0);
  });
}

test.beforeEach(async ({ page }) => {
  await page.route(`${API}/session`, (route) => route.fulfill({
    json: { user: { id: 2, role: "Coordinator" } },
  }));
  await page.route(`${API}/events`, (route) => route.fulfill({
    json: {
      events: [{
        id: EVENT_ID,
        title: "Accessible banquet",
        status: "Planning",
        expected_attendance: 150,
        venue_requirements: "Banquet, Projector",
        accessibility_requirements: "Wheelchair",
        event_datetime: "2099-10-20T06:00:00Z",
      }],
    },
  }));
  await page.route(`${API}/venues?*`, (route) => route.fulfill({
    json: {
      venues: [{
        id: VENUE_ID,
        name: "Small theatre",
        location: "SIS",
        capacity: 100,
        facilities: ["Whiteboard"],
        accessibility: ["Ramp"],
        supported_layouts: ["Theatre"],
        operating_hours: {},
        timezone: "Asia/Singapore",
        created_by: 3,
        created_at: "2026-09-27T04:00:00Z",
      }],
      page: 1,
      has_more: false,
    },
  }));
  await page.route(`${API}/venues/${VENUE_ID}/suitability/${EVENT_ID}`, (route) => route.fulfill({
    json: {
      suitability: {
        is_suitable: false,
        flags: suitabilityFlags,
        checked_rules_count: 4,
      },
      event_id: EVENT_ID,
      venue_id: VENUE_ID,
    },
  }));
  await page.route(`${API}/venues/bookings`, (route) => route.fulfill({
    status: 201,
    json: { booking: { id: "44444444-4444-4444-8444-444444444444" } },
  }));
});

test("Coordinator sees all advisory suitability flags and can still submit", async ({ page }) => {
  await page.goto("/venues/bookings/new");

  await expect(page.getByRole("region", { name: "Venue suitability advisory" })).toBeVisible();
  for (const flag of suitabilityFlags) {
    await expect(page.getByText(flag, { exact: true })).toBeVisible();
  }

  await page.getByLabel("Layout").fill("Banquet");
  await page.getByLabel("Start").fill("2099-10-20T14:00");
  await page.getByLabel("End", { exact: true }).fill("2099-10-20T16:00");
  await page.getByRole("button", { name: "Submit booking request" }).click();

  await expect(page.getByRole("heading", { name: "Booking request submitted" })).toBeVisible();
});

for (const [name, flag] of [
  ["capacity", "Expected attendance (150 pax) exceeds venue capacity (100 pax) by 50 pax."],
  ["layout", "Requested layout(s) not listed in the venue's supported layouts (Theatre): Banquet."],
  ["facility", "Missing required facility feature(s): Projector."],
  ["accessibility", "Missing required accessibility feature(s): Wheelchair."],
] as const) {
  test(`${name} rejection is returned by the API and shown in the UI`, async ({ page }) => {
    await configureSuitabilityScenario(
      page,
      {
        id: VENUE_ID,
        name: "Small theatre",
        location: "SIS",
        capacity: 100,
        facilities: ["Whiteboard"],
        accessibility: ["Ramp"],
        supported_layouts: ["Theatre"],
        operating_hours: {},
        timezone: "Asia/Singapore",
        created_by: 3,
        created_at: "2026-09-27T04:00:00Z",
      },
      {
        id: EVENT_ID,
        title: "Accessible banquet",
        status: "Planning",
        expected_attendance: 150,
        venue_requirements: "Banquet, Projector",
        accessibility_requirements: "Wheelchair",
      },
      [flag],
    );

    await page.goto("/venues/bookings/new");
    await expect(page.getByRole("region", { name: "Venue suitability advisory" })).toBeVisible();
    await expect(page.getByText(flag, { exact: true })).toBeVisible();
  });
}

test("a suitable venue passes API suitability and UI checks", async ({ page }) => {
  await configureSuitabilityScenario(
    page,
    {
      id: VENUE_ID,
      name: "Grand Hall",
      location: "SIS",
      capacity: 200,
      facilities: ["Projector"],
      accessibility: ["Wheelchair"],
      supported_layouts: ["Banquet"],
      operating_hours: {},
      timezone: "Asia/Singapore",
      created_by: 3,
      created_at: "2026-09-27T04:00:00Z",
    },
    {
      id: EVENT_ID,
      title: "Accessible banquet",
      status: "Planning",
      expected_attendance: 150,
      venue_requirements: "Banquet, Projector",
      accessibility_requirements: "Wheelchair",
    },
    [],
  );

  await page.goto("/venues/bookings/new");
  await expect(page.getByText("This venue is suitable for the selected event.", { exact: true })).toBeVisible();
});

test("advisory flags appear in venue search results and venue detail", async ({ page }) => {
  await page.unroute(`${API}/session`);
  await page.route(`${API}/session`, (route) => route.fulfill({
    json: { user: { id: 2, role: "Coordinator" } },
  }));
  await page.route(`${API}/events`, (route) => route.fulfill({
    json: {
      events: [{
        id: EVENT_ID,
        title: "Accessible banquet",
        status: "Planning",
        expected_attendance: 150,
      }],
    },
  }));
  await page.route(`${API}/venues?page=1`, (route) => route.fulfill({
    json: {
      venues: [{
        id: VENUE_ID,
        name: "Small theatre",
        location: "SIS",
        capacity: 100,
        facilities: ["Whiteboard"],
        accessibility: ["Ramp"],
        supported_layouts: ["Theatre"],
        operating_hours: {},
        timezone: "Asia/Singapore",
        created_by: 3,
        created_at: "2026-09-27T04:00:00Z",
      }],
      page: 1,
      has_more: false,
    },
  }));
  await page.route(`${API}/venues/${VENUE_ID}/suitability/${EVENT_ID}`, (route) => route.fulfill({
    json: {
      suitability: {
        is_suitable: false,
        flags: suitabilityFlags,
        checked_rules_count: 4,
      },
    },
  }));
  await page.route(`${API}/venues/${VENUE_ID}/bookings*`, (route) => route.fulfill({ json: { bookings: [] } }));
  await page.route(`${API}/venues/${VENUE_ID}/unavailability*`, (route) => route.fulfill({ json: { blocks: [] } }));
  await page.route(`${API}/venues/${VENUE_ID}`, (route) => route.fulfill({
    json: {
      venue: {
        id: VENUE_ID,
        name: "Small theatre",
        location: "SIS",
        capacity: 100,
        facilities: ["Whiteboard"],
        accessibility: ["Ramp"],
        supported_layouts: ["Theatre"],
        operating_hours: {},
        timezone: "Asia/Singapore",
        created_by: 3,
        created_at: "2026-09-27T04:00:00Z",
      },
    },
  }));

  await page.goto("/venues");
  await page.getByLabel("Check suitability for event").selectOption(EVENT_ID);
  await expect(page.getByRole("region", { name: "Venue suitability advisory for Small theatre" })).toBeVisible();
  await expect(page.getByText(suitabilityFlags[0], { exact: true })).toBeVisible();

  await page.goto(`/venues/${VENUE_ID}?eventId=${EVENT_ID}`);
  await expect(page.getByRole("region", { name: "Venue suitability advisory" })).toBeVisible();
  await expect(page.getByText(suitabilityFlags[0], { exact: true })).toBeVisible();
});
