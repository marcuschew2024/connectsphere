import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
import type { Venue } from "../src/lib/venues";

// SCRUM-163 / Release 1 rows 8, 10, 13. No route mocks: password sessions,
// production UI, real Flask and the disposable acceptance database.
const WEB = "http://localhost:3107";
const API = "http://localhost:5001";
const DATE = "2099-10-20";
const START = `${DATE}T06:00:00Z`; // 14:00 Singapore
const END = `${DATE}T07:00:00Z`;
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const HOURS = Object.fromEntries(DAYS.map(day => [day, { opens: "09:00", closes: "18:00" }]));
type Actor = { page: Page; context: BrowserContext; id: number; name: string };
type Login = (account: string, role: string) => Promise<Actor>;
type Notice = { event_id: string; notification_type: string; recipient_id: number };

const test = base.extend<{ as: Login }>({
  as: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    try {
      await provide(async (account, role) => {
        const context = await browser.newContext({ baseURL: WEB, timezoneId: "Asia/Singapore" });
        contexts.push(context);
        const page = await context.newPage();
        await page.goto("/login");
        await page.getByLabel("Email", { exact: true }).fill(`${account}@connectsphere.test`);
        await page.getByLabel("Password", { exact: true }).fill("disposable-test-only-password");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect(page).toHaveURL(`${WEB}/`);
        const response = await context.request.get(`${API}/session`);
        expect(response.status()).toBe(200);
        const { user } = await response.json();
        expect(user.role).toBe(role);
        return { page, context, id: user.id, name: user.display_name };
      });
    } finally {
      await Promise.all(contexts.map(context => context.close()));
    }
  },
});

async function call(actor: Actor, method: string, path: string, data?: unknown, status = 200) {
  const response = await actor.context.request.fetch(`${API}${path}`, {
    method, data, headers: { Origin: WEB },
  });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(status);
  return response.json();
}

// Prerequisite events are created through the real API; the venue actions under
// test are performed in the browser. Unique names isolate repeated executions.
async function planningEvent(organiser: Actor, lead: Actor, coordinator: Actor, title: string) {
  const { event } = await call(organiser, "POST", "/events", {
    action: "submit", title, description: "Venue flow verification", purpose: "Campus workshop",
    category: "Workshop", event_datetime: START, event_end_datetime: END, expected_attendance: 20,
  }, 201);
  await call(lead, "POST", `/events/${event.id}/coordinator`, { coordinator_id: coordinator.id });
  await call(coordinator, "POST", `/events/${event.id}/decision`, { decision: "approve" });
  return event;
}

async function seedVenue(staff: Actor, name: string, location: string, overrides = {}): Promise<Venue> {
  return (await call(staff, "POST", "/venues", {
    name, location, capacity: 100, facilities: ["Projector"], accessibility: ["Ramp"],
    supported_layouts: ["Classroom"], operating_hours: HOURS, ...overrides,
  }, 201)).venue;
}

async function openBooking(actor: Actor, eventId: string, venueId: string) {
  await actor.page.goto("/venues/bookings/new");
  await actor.page.getByRole("combobox", { name: "Event", exact: true }).selectOption(eventId);
  await actor.page.getByRole("combobox", { name: "Venue", exact: true }).selectOption(venueId);
  await actor.page.getByLabel("Expected attendance").fill("20");
  await actor.page.getByRole("checkbox", { name: "Classroom", exact: true }).check();
  await actor.page.getByLabel("Start", { exact: true }).fill(`${DATE}T14:00`);
  await actor.page.getByLabel("End", { exact: true }).fill(`${DATE}T15:00`);
}

async function searchLocation(page: Page, location: string) {
  await page.goto("/venues");
  await page.getByText("More requirements", { exact: true }).click();
  await page.getByLabel("Location", { exact: true }).fill(location);
  await page.getByRole("button", { name: "Search venues", exact: true }).click();
}

test("INTEGRATED-12 booking approval blocks the slot and notifies only the requesting Coordinator", async ({ as }) => {
  const organiser = await as("organiser.a", "Organiser");
  const lead = await as("coordinator-lead", "Event Coordinator Lead");
  const coordinator = await as("coordinator.a", "Coordinator");
  const other = await as("coordinator.b", "Coordinator");
  const staff = await as("venue-staff", "Venue Staff");
  const tag = crypto.randomUUID();
  const first = await planningEvent(organiser, lead, coordinator, `Approval ${tag}`);
  const second = await planningEvent(organiser, lead, other, `Conflict ${tag}`);
  const room = await seedVenue(staff, `Booking room ${tag}`, tag, {
    setup_time_minutes: 30, turnaround_time_minutes: 30,
  });
  const approvals = async (actor: Actor): Promise<Notice[]> =>
    (await call(actor, "GET", "/notifications")).notifications.filter((n: Notice) =>
      n.event_id === first.id && n.notification_type === "booking_approved");
  expect(await approvals(coordinator)).toHaveLength(0);

  await test.step("Coordinator submits through the UI", async () => {
    await openBooking(coordinator, first.id, room.id);
    const submitted = coordinator.page.waitForResponse(r => r.url() === `${API}/venues/bookings` && r.request().method() === "POST");
    await coordinator.page.getByRole("button", { name: "Submit booking request" }).click();
    expect((await submitted).status()).toBe(201);
    await expect(coordinator.page.getByRole("heading", { name: "Booking request submitted" })).toBeVisible();
  });
  const { bookings } = await call(coordinator, "GET", `/venues/bookings/event/${first.id}`);
  expect(bookings).toHaveLength(1);
  const booking = bookings[0];
  expect(booking).toMatchObject({ status: "Requested", venue_id: room.id,
    event_id: first.id, requested_by: coordinator.id, expected_attendance: 20, layout: "Classroom" });
  expect(Date.parse(booking.start_at)).toBe(Date.parse(START));
  expect(Date.parse(booking.end_at)).toBe(Date.parse(END));
  // A submission notice is not an approval notice; approval must cause the change.
  expect(await approvals(coordinator)).toHaveLength(0);
  await other.page.goto(`/venues/${room.id}?date=${DATE}`);
  await expect(other.page.getByRole("cell", { name: "Tue 2pm: Tentative hold", exact: true })).toBeVisible();
  await staff.page.goto(`/venues/bookings/${booking.id}`);
  await staff.page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(staff.page.getByRole("heading", { name: "Booking confirmed" })).toBeVisible();
  await staff.page.reload();
  await expect(staff.page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  expect((await call(staff, "GET", `/venues/bookings/${booking.id}`)).booking.status).toBe("Confirmed");

  await test.step("Coordinator receives the real notification and follows it after reload", async () => {
    expect(await approvals(coordinator)).toHaveLength(1);
    expect(await approvals(other)).toHaveLength(0);
    await coordinator.page.goto("/");
    await coordinator.page.reload();
    const notice = coordinator.page.getByRole("region", { name: "Notifications" })
      .getByRole("listitem").filter({ hasText: first.title }).filter({ hasText: "Your venue booking was approved" });
    await expect(notice).toHaveCount(1);
    await notice.getByRole("link", { name: "View request" }).click();
    await expect(coordinator.page).toHaveURL(`${WEB}/events/${first.id}`);
    await expect(coordinator.page.getByText(room.name, { exact: true })).toBeVisible();
    await coordinator.page.reload();
    await expect(coordinator.page.getByText(room.name, { exact: true })).toBeVisible();
    expect(await approvals(coordinator)).toHaveLength(1);
  });

  await test.step("Calendar and another Coordinator observe the occupied slot and buffers", async () => {
    const calendar = (await call(other, "GET",
      `/venues/${room.id}/bookings?from=${DATE}T00:00:00Z&to=${DATE}T23:59:59Z`)).bookings;
    expect(calendar).toHaveLength(1);
    expect(Date.parse(calendar[0].start_at)).toBe(Date.parse(START));
    expect(Date.parse(calendar[0].end_at)).toBe(Date.parse(END));
    expect(Date.parse(calendar[0].occupied_start)).toBe(Date.parse(`${DATE}T05:30:00Z`));
    expect(Date.parse(calendar[0].occupied_end)).toBe(Date.parse(`${DATE}T07:30:00Z`));
    await other.page.goto(`/venues/${room.id}?date=${DATE}`);
    for (const hour of ["1pm", "2pm", "3pm"]) {
      await expect(other.page.getByRole("cell", { name: `Tue ${hour}: Confirmed`, exact: true })).toBeVisible();
    }
    await expect(other.page.getByRole("cell", { name: "Tue 4pm: Available", exact: true })).toBeVisible();
    await other.page.reload();
    await expect(other.page.getByRole("cell", { name: "Tue 2pm: Confirmed", exact: true })).toBeVisible();
    await openBooking(other, second.id, room.id);
    for (const [start, end] of [["14:00", "15:00"], ["15:30", "16:30"]]) {
      // 15:30 does not overlap the event itself, but its setup overlaps turnaround.
      await other.page.getByLabel("Start", { exact: true }).fill(`${DATE}T${start}`);
      await other.page.getByLabel("End", { exact: true }).fill(`${DATE}T${end}`);
      const rejected = other.page.waitForResponse(r => r.url() === `${API}/venues/bookings` && r.request().method() === "POST");
      await other.page.getByRole("button", { name: "Submit booking request" }).click();
      expect((await rejected).status()).toBe(409);
      await expect(other.page.locator("main").getByRole("alert")).toContainText(/confirmed|conflict|booked/i);
      await expect(other.page.getByRole("heading", { name: "Booking request submitted" })).toHaveCount(0);
      await expect(other.page.getByLabel("Start", { exact: true })).toHaveValue(`${DATE}T${start}`);
    }
    expect((await call(other, "GET", `/venues/bookings/event/${second.id}`)).bookings).toEqual([]);
    expect((await call(coordinator, "GET", `/venues/bookings/${booking.id}`)).booking.status).toBe("Confirmed");
    expect(await approvals(coordinator)).toHaveLength(1);
    // At 16:00 the buffered intervals only touch: do not reject every later slot.
    await other.page.getByLabel("Start", { exact: true }).fill(`${DATE}T16:00`);
    await other.page.getByLabel("End", { exact: true }).fill(`${DATE}T17:00`);
    await other.page.getByRole("button", { name: "Submit booking request" }).click();
    await expect(other.page.getByRole("heading", { name: "Booking request submitted" })).toBeVisible();
    const adjacent = (await call(other, "GET", `/venues/bookings/event/${second.id}`)).bookings;
    expect(adjacent).toHaveLength(1);
    expect(adjacent[0]).toMatchObject({ venue_id: room.id, status: "Requested" });
    expect(Date.parse(adjacent[0].start_at)).toBe(Date.parse(`${DATE}T08:00:00Z`));
    expect(Date.parse(adjacent[0].end_at)).toBe(Date.parse(`${DATE}T09:00:00Z`));
  });
});

test("INTEGRATED-13 Venue Staff creates edits and retires a complete venue record with layouts", async ({ as }) => {
  const staff = await as("venue-staff", "Venue Staff");
  const coordinator = await as("coordinator.a", "Coordinator");
  const tag = crypto.randomUUID();
  const name = `Catalogue ${tag}`;
  const location = `Campus ${tag}`;
  await staff.page.goto("/venues/new");
  await staff.page.getByLabel("Venue name").fill(name);
  await staff.page.getByLabel("Location", { exact: false }).fill(location);
  await staff.page.getByLabel("Capacity", { exact: false }).fill("100");
  for (const option of ["Projector", "Wi-Fi", "Ramp", "Classroom", "Theatre"]) {
    await staff.page.getByRole("checkbox", { name: option, exact: true }).check();
  }
  await staff.page.getByLabel("Setup buffer (mins)").fill("15");
  await staff.page.getByLabel("Turnaround buffer (mins)").fill("30");
  const created = staff.page.waitForResponse(r => r.url() === `${API}/venues` && r.request().method() === "POST");
  await staff.page.getByRole("button", { name: "Save venue", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { venue: room } = await response.json();
  await expect(staff.page.getByRole("heading", { name: "Venue added" })).toBeVisible();
  const original = (await call(staff, "GET", `/venues/${room.id}`)).venue;
  expect(original).toMatchObject({ name, location, capacity: 100, facilities: ["Projector", "Wi-Fi"],
    accessibility: ["Ramp"], supported_layouts: ["Theatre", "Classroom"],
    setup_time_minutes: 15, turnaround_time_minutes: 30, timezone: "Asia/Singapore", created_by: staff.id,
    operating_hours: Object.fromEntries(DAYS.map((day, i) => [day, i < 5 ? HOURS[day] : null])),
  });
  expect(Number.isFinite(Date.parse(original.created_at))).toBe(true);
  await searchLocation(coordinator.page, location);
  const card = coordinator.page.getByRole("listitem").filter({ has: coordinator.page.getByRole("heading", { name, exact: true }) });
  for (const text of [location, "100 people", "Theatre · Classroom", "Projector · Wi-Fi", "Ramp", `by ${staff.name}`]) {
    await expect(card).toContainText(text);
  }
  await card.locator("summary").click();
  await expect(card.getByText("09:00 – 18:00")).toHaveCount(5);
  await expect(card.getByText("Closed", { exact: true })).toHaveCount(2);

  await staff.page.goto(`/venues/${room.id}/edit`);
  await expect(staff.page.getByLabel("Venue name")).toHaveValue(name);
  await expect(staff.page.getByRole("checkbox", { name: "Classroom", exact: true })).toBeChecked();
  await staff.page.getByLabel("Capacity", { exact: false }).fill("80");
  await staff.page.getByRole("checkbox", { name: "Theatre", exact: true }).uncheck();
  await staff.page.getByRole("checkbox", { name: "Projector", exact: true }).uncheck();
  await staff.page.getByRole("checkbox", { name: "Whiteboard", exact: true }).check();
  await staff.page.getByLabel("monday opens").fill("10:00");
  await staff.page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(staff.page.getByRole("heading", { name: "Venue updated" })).toBeVisible();
  await staff.page.goto(`/venues/${room.id}/edit`);
  await staff.page.reload();
  await expect(staff.page.getByLabel("Capacity", { exact: false })).toHaveValue("80");
  await expect(staff.page.getByRole("checkbox", { name: "Theatre", exact: true })).not.toBeChecked();
  await expect(staff.page.getByLabel("monday opens")).toHaveValue("10:00");
  const updated = (await call(coordinator, "GET", `/venues/${room.id}`)).venue;
  expect(updated).toMatchObject({ capacity: 80, supported_layouts: ["Classroom"],
    facilities: ["Wi-Fi", "Whiteboard"], accessibility: ["Ramp"],
    name, location, created_by: staff.id, created_at: original.created_at,
    setup_time_minutes: 15, turnaround_time_minutes: 30,
    operating_hours: { ...original.operating_hours, monday: { opens: "10:00", closes: "18:00" } },
  });
  await searchLocation(coordinator.page, location);
  await expect(card).toContainText("80 people");
  await expect(card).toContainText("Wi-Fi · Whiteboard");
  await expect(card.getByText("Classroom", { exact: true })).toBeVisible();
  await expect(card.getByText("Theatre", { exact: true })).toHaveCount(0);
  await staff.page.goto(`/venues/${room.id}`);
  await staff.page.getByText("Retire venue", { exact: true }).click();
  await staff.page.getByRole("button", { name: "Continue to retirement" }).click();
  await staff.page.getByRole("button", { name: "Confirm retirement" }).click();
  const retired = staff.page.getByRole("status").filter({ hasText: "Venue retired" });
  await expect(retired).toContainText(staff.name);
  await staff.page.reload();
  await expect(retired).toContainText(staff.name);
  const storedRetired = (await call(staff, "GET", `/venues/${room.id}`)).venue;
  expect(storedRetired).toMatchObject({
    name, location, capacity: 80, supported_layouts: ["Classroom"], is_retired: true, retired_by: staff.id,
    facilities: updated.facilities, accessibility: updated.accessibility,
    operating_hours: updated.operating_hours, setup_time_minutes: 15, turnaround_time_minutes: 30,
    timezone: "Asia/Singapore", created_by: staff.id, created_at: original.created_at,
    reference: original.reference,
  });
  expect(Number.isFinite(Date.parse(storedRetired.retired_at))).toBe(true);
  await searchLocation(coordinator.page, location);
  await expect(coordinator.page.getByRole("heading", { name: "No venues match", exact: true })).toBeVisible();
  await staff.page.goto(`/venues/${room.id}/edit`);
  await expect(staff.page.locator("main").getByRole("alert")).toContainText("This venue is retired");
  await expect(staff.page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
});

test("INTEGRATED-14 venue date capacity and facility filters exclude independently unsuitable results", async ({ as }) => {
  const staff = await as("venue-staff", "Venue Staff");
  const coordinator = await as("coordinator.a", "Coordinator");
  const location = `Search ${crypto.randomUUID()}`;
  const match = await seedVenue(staff, `Matching ${location}`, location);
  const small = await seedVenue(staff, `Too small ${location}`, location, { capacity: 40 });
  const missing = await seedVenue(staff, `No projector ${location}`, location, { facilities: ["Whiteboard"] });
  const blocked = await seedVenue(staff, `Occupied ${location}`, location);
  await call(staff, "POST", `/venues/${blocked.id}/unavailability`, { start_at: START, end_at: END, reason: "Maintenance" }, 201);
  await searchLocation(coordinator.page, location);
  // Establish all four records are visible before applying the independent filters.
  for (const room of [match, small, missing, blocked]) {
    await expect(coordinator.page.getByRole("heading", { name: room.name, exact: true })).toBeVisible();
  }
  await coordinator.page.getByLabel("Minimum capacity", { exact: true }).fill("50");
  await coordinator.page.getByRole("checkbox", { name: "Projector", exact: true }).check();
  await coordinator.page.getByLabel("Date", { exact: true }).fill(DATE);
  await coordinator.page.getByLabel("Start time", { exact: true }).fill("14:00");
  await coordinator.page.getByLabel("End time", { exact: true }).fill("15:00");
  await coordinator.page.getByRole("checkbox", { name: "Only show available venues" }).check();
  await coordinator.page.getByRole("button", { name: "Search venues", exact: true }).click();
  await expect(coordinator.page.getByRole("heading", { name: match.name, exact: true })).toBeVisible();
  for (const room of [small, missing, blocked]) {
    await expect(coordinator.page.getByRole("heading", { name: room.name, exact: true })).toHaveCount(0);
  }
  await expect(coordinator.page.getByRole("region", { name: "Search results summary" })).toContainText("1 venue on this page");
  await expect(coordinator.page.getByText("Available for selected time", { exact: true })).toBeVisible();
  // The same day is not wholly blocked: touching the maintenance end is available.
  await coordinator.page.getByLabel("Start time", { exact: true }).fill("15:00");
  await coordinator.page.getByLabel("End time", { exact: true }).fill("16:00");
  await coordinator.page.getByRole("button", { name: "Search venues", exact: true }).click();
  await expect(coordinator.page.getByRole("heading", { name: blocked.name, exact: true })).toBeVisible();
  await expect(coordinator.page.getByRole("region", { name: "Search results summary" })).toContainText("2 venues on this page");
  await coordinator.page.getByLabel("Start time", { exact: true }).fill("14:00");
  await coordinator.page.getByLabel("End time", { exact: true }).fill("15:00");
  await coordinator.page.getByRole("button", { name: "Search venues", exact: true }).click();
  await expect(coordinator.page.getByRole("region", { name: "Search results summary" })).toContainText("1 venue on this page");
  await expect(coordinator.page.getByRole("heading", { name: blocked.name, exact: true })).toHaveCount(0);
  // A date change alone releases the maintenance exclusion; other filters still apply.
  await coordinator.page.getByLabel("Date", { exact: true }).fill("2099-10-21");
  await coordinator.page.getByRole("button", { name: "Search venues", exact: true }).click();
  await expect(coordinator.page.getByRole("heading", { name: blocked.name, exact: true })).toBeVisible();
  await expect(coordinator.page.getByRole("heading", { name: match.name, exact: true })).toBeVisible();
  await expect(coordinator.page.getByRole("region", { name: "Search results summary" })).toContainText("2 venues on this page");
  for (const room of [small, missing]) {
    await expect(coordinator.page.getByRole("heading", { name: room.name, exact: true })).toHaveCount(0);
  }
});
