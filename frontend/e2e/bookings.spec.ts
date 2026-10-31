import { test, expect } from "@playwright/test";

// SCRUM-31 booking submission and SCRUM-122 booking decision UI.
test.use({ timezoneId: "Asia/Singapore" });

const BOOKING_ID = "22222222-2222-4222-8222-222222222222";
const API_ORIGIN = "http://localhost:5001";

const PENDING_BOOKING = {
  id: BOOKING_ID,
  event_id: "11111111-1111-4111-8111-111111111111",
  venue_id: "33333333-3333-4333-8333-333333333333",
  start_at: "2099-10-20T06:00:00Z", // 2pm SGT
  end_at: "2099-10-20T08:00:00Z", // 4pm SGT
  status: "Pending",
  decision_reason: null,
  suggested_alternative: null,
  decided_by: null,
  decision_at: null,
  requested_by: 2,
  created_at: "2026-09-27T04:00:00Z",
  venue: { name: "Auditorium A", location: "Level 3, SIS" },
  event: { title: "Campus workshop" },
};

const REQUEST_EVENT = { id: PENDING_BOOKING.event_id, title: "Campus workshop", status: "Planning", event_datetime: "2099-10-20T06:00:00Z", is_mine: true };
// SCRUM-151: a Planning event assigned to another Coordinator. The API returns it (view-all,
// S1 Q34) but with is_mine false; the booking picker must not offer it (act-only-on-own, S1 Q1).
const OTHER_COORDINATOR_EVENT = { id: "44444444-4444-4444-8444-444444444444", title: "Other coordinator's summit", status: "Planning", event_datetime: "2099-11-01T06:00:00Z", is_mine: false };
const REQUEST_VENUE = { id: PENDING_BOOKING.venue_id, name: "Auditorium A", location: "Level 3, SIS", capacity: 300, facilities: [], accessibility: [], supported_layouts: ["Theatre"], operating_hours: {}, timezone: "Asia/Singapore", created_by: 3, created_at: "2026-09-27T04:00:00Z" };

test.beforeEach(async ({ page }) => {
  await page.route("**/notifications", (route) => route.fulfill({ json: { notifications: [] } }));
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: 3, display_name: "Demo Venue Staff", role: "Venue Staff" },
  } }));
  await page.route(`${API_ORIGIN}/venues/bookings/${BOOKING_ID}`, (route) =>
    route.fulfill({ json: { booking: PENDING_BOOKING } }));
});

test("venue staff can approve a pending booking", async ({ page }) => {
  await page.route(`${API_ORIGIN}/venues/bookings/${BOOKING_ID}/decision`, async (route) => {
    const body = route.request().postDataJSON();
    expect(body.decision).toBe("approve");
    expect(body).not.toHaveProperty("reason");
    await route.fulfill({ json: { booking: {
      ...PENDING_BOOKING, status: "Confirmed", decided_by: 3, decision_at: "2026-09-27T05:00:00Z",
    } } });
  });

  await page.goto(`/venues/bookings/${BOOKING_ID}`);
  await expect(page.getByRole("heading", { name: "Auditorium A" })).toBeVisible();

  const decided = page.waitForResponse((response) =>
    response.url() === `${API_ORIGIN}/venues/bookings/${BOOKING_ID}/decision`);
  await page.getByRole("button", { name: "Approve" }).click();
  await decided;

  await expect(page.getByRole("heading", { name: "Booking confirmed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("venue staff can reject with a reason and a suggested alternative", async ({ page }) => {
  await page.route(`${API_ORIGIN}/venues/bookings/${BOOKING_ID}/decision`, async (route) => {
    const body = route.request().postDataJSON();
    expect(body.decision).toBe("reject");
    expect(body.reason).toBe("The venue is double-booked.");
    expect(body.alternative).toBe("Room B, 4-6pm");
    await route.fulfill({ json: { booking: {
      ...PENDING_BOOKING, status: "Rejected", decision_reason: body.reason,
      suggested_alternative: body.alternative, decided_by: 3, decision_at: "2026-09-27T05:00:00Z",
    } } });
  });

  await page.goto(`/venues/bookings/${BOOKING_ID}`);
  await page.getByLabel("Rejection reason").fill("The venue is double-booked.");
  await page.getByLabel("Suggested alternative (optional)").fill("Room B, 4-6pm");

  const decided = page.waitForResponse((response) =>
    response.url() === `${API_ORIGIN}/venues/bookings/${BOOKING_ID}/decision`);
  await page.getByRole("button", { name: "Reject" }).click();
  await decided;

  await expect(page.getByRole("heading", { name: "Booking rejected" })).toBeVisible();
  await expect(page.getByText("The venue is double-booked.")).toBeVisible();
  await expect(page.getByText("Suggested alternative: Room B, 4-6pm")).toBeVisible();
});

test("rejecting with an empty reason is blocked before any request", async ({ page }) => {
  let decisionCalls = 0;
  await page.route(`${API_ORIGIN}/venues/bookings/${BOOKING_ID}/decision`, async (route) => {
    decisionCalls += 1;
    await route.fulfill({ json: { booking: PENDING_BOOKING } });
  });

  await page.goto(`/venues/bookings/${BOOKING_ID}`);
  await page.getByRole("button", { name: "Reject" }).click();

  await expect(page.getByText("A reason is required when rejecting a request.")).toBeVisible();
  expect(decisionCalls).toBe(0);
  // The form is still shown; nothing was decided.
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
});

test("the decision form is hidden for non venue staff", async ({ page }) => {
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: 2, display_name: "Demo Coordinator", role: "Coordinator" },
  } }));

  await page.goto(`/venues/bookings/${BOOKING_ID}`);
  await expect(page.getByRole("heading", { name: "Auditorium A" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review booking" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("coordinator submits a venue request with timing and requirements", async ({ page }) => {
  await page.unroute("**/session");
  await page.route(`${API_ORIGIN}/session`, (route) => route.fulfill({ json: { user: { id: 2, role: "Coordinator" } } }));
  await page.route(`${API_ORIGIN}/events`, (route) => route.fulfill({ json: { events: [REQUEST_EVENT] } }));
  await page.route(`${API_ORIGIN}/venues?*`, (route) => route.fulfill({ json: { venues: [REQUEST_VENUE], page: 1, has_more: false } }));
  await page.route(`${API_ORIGIN}/venues/bookings`, async (route) => {
    const body = route.request().postDataJSON();
    expect(body.event_id).toBe(REQUEST_EVENT.id);
    expect(body.venue_id).toBe(REQUEST_VENUE.id);
    expect(body.expected_attendance).toBe(120);
    expect(body.layout).toBe("Theatre");
    expect(body.special_requirements).toBe("Step-free access");
    await route.fulfill({ status: 201, json: { booking: { ...PENDING_BOOKING, status: "Requested" } } });
  });
  await page.goto("/venues/bookings/new");
  // Options load asynchronously and initialise attendance; wait before editing it.
  await expect(page.getByRole("combobox", { name: "Venue", exact: true })).toHaveValue(REQUEST_VENUE.id);
  await page.getByLabel("Expected attendance").fill("120");
  await page.getByLabel("Layout").fill("Theatre");
  await page.getByLabel("Special requirements").fill("Step-free access");
  await page.getByLabel("Start").fill("2099-10-20T14:00");
  await page.getByLabel("End", { exact: true }).fill("2099-10-20T16:00");
  await page.getByRole("button", { name: "Submit booking request" }).click();
  await expect(page.getByRole("heading", { name: "Booking request submitted" })).toBeVisible();
});

test("the event picker offers only the coordinator's own Planning events (SCRUM-151)", async ({ page }) => {
  await page.unroute("**/session");
  await page.route(`${API_ORIGIN}/session`, (route) => route.fulfill({ json: { user: { id: 2, role: "Coordinator" } } }));
  // API returns both events (view-all), but only the owned one carries is_mine: true.
  await page.route(`${API_ORIGIN}/events`, (route) =>
    route.fulfill({ json: { events: [OTHER_COORDINATOR_EVENT, REQUEST_EVENT] } }));
  await page.route(`${API_ORIGIN}/venues?*`, (route) => route.fulfill({ json: { venues: [REQUEST_VENUE], page: 1, has_more: false } }));
  await page.goto("/venues/bookings/new");

  await expect(page.getByRole("combobox", { name: "Venue", exact: true })).toHaveValue(REQUEST_VENUE.id);
  const eventPicker = page.getByRole("combobox", { name: "Event", exact: true });
  // Only the owned event is a selectable option; the other coordinator's event is absent.
  await expect(eventPicker.getByRole("option")).toHaveCount(1);
  await expect(eventPicker.getByRole("option", { name: /Campus workshop/ })).toHaveCount(1);
  await expect(eventPicker.getByRole("option", { name: /Other coordinator's summit/ })).toHaveCount(0);
});

test("venue overlap rejection preserves the booking form", async ({ page }) => {
  await page.unroute("**/session");
  await page.route(`${API_ORIGIN}/session`, (route) => route.fulfill({ json: { user: { id: 2, role: "Coordinator" } } }));
  await page.route(`${API_ORIGIN}/events`, (route) => route.fulfill({ json: { events: [REQUEST_EVENT] } }));
  await page.route(`${API_ORIGIN}/venues?*`, (route) => route.fulfill({ json: { venues: [REQUEST_VENUE], page: 1, has_more: false } }));
  await page.route(`${API_ORIGIN}/venues/bookings`, (route) => route.fulfill({ status: 409, json: { error: "The venue is already confirmed or blocked for that time slot." } }));
  await page.goto("/venues/bookings/new");
  // Options load asynchronously and initialise attendance; wait before editing it.
  await expect(page.getByRole("combobox", { name: "Venue", exact: true })).toHaveValue(REQUEST_VENUE.id);
  await page.getByLabel("Expected attendance").fill("120");
  await page.getByLabel("Layout").fill("Theatre");
  await page.getByLabel("Start").fill("2099-10-20T14:00");
  await page.getByLabel("End", { exact: true }).fill("2099-10-20T16:00");
  await page.getByRole("button", { name: "Submit booking request" }).click();
  await expect(page.getByText("The venue is already confirmed or blocked for that time slot.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Booking request submitted" })).toHaveCount(0);
  await expect(page.getByLabel("Expected attendance")).toHaveValue("120");
});

test("buffered adjacent slot conflicts for a second coordinator", async ({ page }) => {
  await page.unroute("**/session");
  await page.route(`${API_ORIGIN}/session`, (route) => route.fulfill({
    json: { user: { id: 9, display_name: "Second Coordinator", role: "Coordinator" } },
  }));
  await page.route(`${API_ORIGIN}/events`, (route) => route.fulfill({ json: { events: [REQUEST_EVENT] } }));
  await page.route(`${API_ORIGIN}/venues?*`, (route) => route.fulfill({ json: { venues: [REQUEST_VENUE], page: 1, has_more: false } }));
  await page.route(`${API_ORIGIN}/venues/bookings`, async (route) => {
    expect(route.request().postDataJSON().start_at).toMatch(/^2099-10-20T08:15:00(?:\.000)?Z$/);
    await route.fulfill({
      status: 409,
      json: { error: "That time conflicts with an approved booking and its setup/turnaround buffer." },
    });
  });

  await page.goto("/venues/bookings/new");
  await page.getByLabel("Expected attendance").fill("120");
  await page.getByLabel("Layout").fill("Theatre");
  await page.getByLabel("Start").fill("2099-10-20T16:15");
  await page.getByLabel("End", { exact: true }).fill("2099-10-20T18:15");
  await page.getByRole("button", { name: "Submit booking request" }).click();

  await expect(page.getByText(
    "That time conflicts with an approved booking and its setup/turnaround buffer.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByRole("heading", { name: "Booking request submitted" })).toHaveCount(0);
});

test("booking form shows over-capacity as advisory and still allows the request", async ({ page }) => {
  await page.unroute("**/session");
  await page.route(`${API_ORIGIN}/session`, (route) => route.fulfill({ json: { user: { id: 2, role: "Coordinator" } } }));
  await page.route(`${API_ORIGIN}/events`, (route) => route.fulfill({ json: { events: [REQUEST_EVENT] } }));
  await page.route(`${API_ORIGIN}/venues?*`, (route) => route.fulfill({ json: { venues: [{ ...REQUEST_VENUE, capacity: 50 }], page: 1, has_more: false } }));
  await page.route(`${API_ORIGIN}/venues/${REQUEST_VENUE.id}/suitability/${REQUEST_EVENT.id}`, (route) => route.fulfill({
    json: {
      suitability: {
        is_suitable: false,
        flags: ["Expected attendance (51 pax) exceeds venue capacity (50 pax) by 1 pax."],
        checked_rules_count: 4,
      },
      event_id: REQUEST_EVENT.id,
      venue_id: REQUEST_VENUE.id,
    },
  }));
  let requests = 0;
  await page.route(`${API_ORIGIN}/venues/bookings`, (route) => { requests += 1; return route.fulfill({ status: 201, json: { booking: PENDING_BOOKING } }); });
  await page.goto("/venues/bookings/new");
  // Options load asynchronously and initialise attendance; wait before editing it.
  await expect(page.getByRole("combobox", { name: "Venue", exact: true })).toHaveValue(REQUEST_VENUE.id);
  await page.getByLabel("Expected attendance").fill("51");
  await page.getByLabel("Layout").fill("Theatre");
  await page.getByLabel("Start").fill("2099-10-20T14:00");
  await page.getByLabel("End", { exact: true }).fill("2099-10-20T16:00");
  await expect(page.getByRole("region", { name: "Venue suitability advisory" })).toBeVisible();
  await expect(page.getByText("Expected attendance (51 pax) exceeds venue capacity (50 pax) by 1 pax.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit booking request" }).click();
  expect(requests).toBe(1);
});

test("booking form blocks an end time before the start time", async ({ page }) => {
  await page.unroute("**/session");
  await page.route(`${API_ORIGIN}/session`, (route) => route.fulfill({ json: { user: { id: 2, role: "Coordinator" } } }));
  await page.route(`${API_ORIGIN}/events`, (route) => route.fulfill({ json: { events: [REQUEST_EVENT] } }));
  await page.route(`${API_ORIGIN}/venues?*`, (route) => route.fulfill({ json: { venues: [REQUEST_VENUE], page: 1, has_more: false } }));
  let requests = 0;
  await page.route(`${API_ORIGIN}/venues/bookings`, (route) => { requests += 1; return route.fulfill({ status: 201, json: { booking: PENDING_BOOKING } }); });
  await page.goto("/venues/bookings/new");
  // Options load asynchronously and initialise attendance; wait before editing it.
  await expect(page.getByRole("combobox", { name: "Venue", exact: true })).toHaveValue(REQUEST_VENUE.id);
  await page.getByLabel("Expected attendance").fill("120");
  await page.getByLabel("Layout").fill("Theatre");
  await page.getByLabel("Start").fill("2099-10-20T16:00");
  await page.getByLabel("End", { exact: true }).fill("2099-10-20T14:00");
  await page.getByRole("button", { name: "Submit booking request" }).click();
  await expect(page.getByText("The end date and time must be after the start date and time.", { exact: true })).toBeVisible();
  expect(requests).toBe(0);
});
