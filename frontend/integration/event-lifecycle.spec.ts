import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const API = "http://localhost:5001";
const ORIGIN = "http://localhost:3107";
const PASSWORD = "disposable-test-only-password";
const START = "2099-10-20T06:00:00Z";
const END = "2099-10-20T07:00:00Z";

type Actor = { context: BrowserContext; page: Page; id: number; name: string };

async function login(browser: Browser, account: string, role: string): Promise<Actor> {
  const context = await browser.newContext({ baseURL: ORIGIN, timezoneId: "Asia/Singapore" });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(`${account}@connectsphere.test`);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${ORIGIN}/`);
  const response = await context.request.get(`${API}/session`, { headers: { Origin: ORIGIN } });
  expect(response.status()).toBe(200);
  const { user } = await response.json();
  expect(user.role).toBe(role);
  return { context, page, id: user.id, name: user.display_name };
}

async function call(actor: Actor, method: string, path: string, data?: unknown, status = 200) {
  const response = await actor.context.request.fetch(`${API}${path}`, {
    method, data, headers: { Origin: ORIGIN },
  });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(status);
  return response.json();
}

async function submittedEvent(organiser: Actor, title: string) {
  return (await call(organiser, "POST", "/events", {
    action: "submit", title, description: "Campus workshop", purpose: "Private planning",
    category: "Workshop", event_datetime: START, expected_attendance: 2,
  }, 201)).event;
}

async function planningEvent(organiser: Actor, lead: Actor, coordinator: Actor, title: string) {
  const event = await submittedEvent(organiser, title);
  await call(lead, "POST", `/events/${event.id}/coordinator`, { coordinator_id: coordinator.id });
  await call(coordinator, "POST", `/events/${event.id}/decision`, { decision: "approve" });
  return event;
}

async function venue(staff: Actor, name: string) {
  return (await call(staff, "POST", "/venues", {
    name, location: "QA campus", capacity: 20, facilities: ["Projector"],
    accessibility: ["Step-free access"], supported_layouts: ["Classroom"],
    operating_hours: Object.fromEntries([
      "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    ].map((day) => [day, { opens: "00:00", closes: "23:59" }])),
  }, 201)).venue;
}

async function book(coordinator: Actor, eventId: string, venueId: string) {
  return (await call(coordinator, "POST", "/venues/bookings", {
    event_id: eventId, venue_id: venueId, start_at: START, end_at: END,
    expected_attendance: 2, layout: "Classroom",
  }, 201)).booking;
}

test("INTEGRATED-01 same event crosses seven password-authenticated roles and persists after reload", async ({ browser }) => {
  const actors: Actor[] = [];
  const as = async (account: string, role: string) => {
    const actor = await login(browser, account, role);
    actors.push(actor);
    return actor;
  };
  try {
    const organiser = await as("organiser.a", "Organiser");
    const lead = await as("coordinator-lead", "Event Coordinator Lead");
    const coordinator = await as("coordinator.a", "Coordinator");
    const staff = await as("venue-staff", "Venue Staff");
    const tech = await as("tech-support", "Tech Support");
    const safety = await as("safety-officer", "Safety Officer");
    const attendee = await as("attendee.a", "Attendee");
    const title = "Campus Skills Workshop";

    await organiser.page.goto("/events/new");
    await organiser.page.getByLabel("Event name").fill(title);
    const draftResponse = organiser.page.waitForResponse((r) => r.url() === `${API}/events` && r.request().method() === "POST");
    await organiser.page.getByRole("button", { name: "Save as draft", exact: true }).click();
    const { event } = await (await draftResponse).json();
    expect(event.reference).toMatch(/^EVT-\d{3,}$/);
    await expect(organiser.page.getByRole("heading", { name: "Draft saved", exact: true })).toBeVisible();
    await organiser.page.goto(`/events/drafts/${event.id}`);
    await expect(organiser.page.getByLabel("Event name")).toHaveValue(title);
    await organiser.page.getByLabel("Description").fill("Learn together");
    await organiser.page.getByLabel("Purpose").fill("Private planning notes");
    await organiser.page.getByLabel("Category").fill("Workshop");
    await organiser.page.getByLabel("Preferred date and time").fill("2099-10-20T14:00");
    await organiser.page.getByLabel("Expected attendance").fill("2");
    await organiser.page.getByRole("button", { name: "Submit request", exact: true }).click();
    await expect(organiser.page.getByRole("heading", { name: "Event request received", exact: true })).toBeVisible();

    await lead.page.goto("/events/supervised");
    const intake = lead.page.getByRole("listitem").filter({ has: lead.page.locator(`a[href="/events/${event.id}"]`) });
    await intake.getByLabel(`Assign ${title} to`, { exact: true }).selectOption(String(coordinator.id));
    await intake.getByRole("button", { name: `Assign ${title}`, exact: true }).click();
    await expect(lead.page.getByRole("region", { name: "Assigned events" }).locator(`a[href="/events/${event.id}"]`)).toHaveText(title);
    await coordinator.page.goto(`/events/${event.id}`);
    await coordinator.page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(coordinator.page.getByTestId("event-status-badge")).toHaveText("Planning");
    await call(organiser, "PUT", `/events/${event.id}/registration-capacity`, { capacity: 1 });

    // Real resource API calls share each actor's password cookie. These steps are
    // API integration evidence; this test does not claim catalogue/form UI coverage.
    for (let index = 0; index < 2; index++) {
      const room = await venue(staff, `${title} room ${index + 1} (${event.reference})`);
      expect(room.reference).toMatch(/^VNU-\d{3,}$/);
      const booking = await book(coordinator, event.id, room.id);
      expect(booking.reference).toMatch(/^BKG-\d{3,}$/);
      await staff.page.goto(`/venues/bookings/${booking.id}`);
      await expect(staff.page.getByText(new RegExp(`^${booking.reference} ·`))).toBeVisible();
      await staff.page.goto(`/venues/${room.id}`);
      await expect(staff.page.getByText(new RegExp(`^${room.reference} ·`))).toBeVisible();
      await call(staff, "POST", `/venues/bookings/${booking.id}/decision`, { decision: "approve" });
    }
    const { equipment } = await call(tech, "POST", "/equipment", {
      equipment_type: `${title} projector (${event.reference})`, description: "Test projector", total_quantity: 1,
      location: "QA store", operational_status: "Operational",
    }, 201);
    expect(equipment.reference).toMatch(/^EQP-\d{3,}$/);
    await tech.page.goto("/equipment");
    await expect(tech.page.getByText(new RegExp(`^${equipment.reference} ·`))).toBeVisible();
    const { request } = await call(coordinator, "POST", "/equipment/requests", {
      event_id: event.id, items: [{ equipment_id: equipment.id, quantity: 1, technical_notes: "HDMI" }],
    }, 201);
    expect(request.reference).toMatch(/^EQR-\d{3,}$/);
    await tech.page.goto(`/equipment/requests/${request.id}`);
    await expect(tech.page.getByText(new RegExp(`Request reference: ${request.reference} ·`))).toBeVisible();
    await coordinator.page.reload();
    await coordinator.page.getByRole("button", { name: "Confirm event", exact: true }).click();
    await expect(coordinator.page.getByTestId("confirm-blocked-message")).toContainText(/equipment|technical/i);
    await expect(coordinator.page.getByTestId("event-status-badge")).toHaveText("Planning");
    await call(tech, "PUT", `/equipment/requests/${request.id}/reservations`, {
      start_at: START, end_at: END, revision: request.revision, notes: "Ready",
      items: [{ equipment_id: equipment.id, quantity: 1 }],
    });
    await coordinator.page.getByRole("button", { name: "Confirm event", exact: true }).click();
    await expect(coordinator.page.getByTestId("event-status-badge")).toHaveText("Confirmed");

    await attendee.page.goto(`/events/browse/${event.id}`);
    await attendee.page.getByRole("button", { name: "Register for event", exact: true }).click();
    await expect(attendee.page.getByRole("heading", { name: "Registration confirmed", exact: true })).toBeVisible();
    const receipt = (await call(attendee, "GET", `/events/${event.id}/registration-offer`)).registration;
    expect(receipt.reference).toMatch(/^REG-\d{3,}$/);
    await expect(attendee.page.getByText(new RegExp(`^${receipt.reference} ·`))).toBeVisible();
    await attendee.page.reload();
    await expect(attendee.page.getByRole("heading", { name: "Registration confirmed", exact: true })).toBeVisible();
    await call(attendee, "PATCH", `/events/${event.id}/status`, { status: "Cancelled" }, 403);
    await attendee.page.getByRole("button", { name: "Withdraw registration", exact: true }).click();
    await attendee.page.getByRole("button", { name: "Confirm withdrawal", exact: true }).click();
    await expect(attendee.page.getByRole("heading", { name: "Registration withdrawn", exact: true })).toBeVisible();
    await expect(attendee.page.getByText(new RegExp(`^${receipt.reference} ·`))).toBeVisible();
    await attendee.page.reload();
    await expect(attendee.page.getByRole("heading", { name: "Registration withdrawn", exact: true })).toBeVisible();
    const offer = await call(attendee, "GET", `/events/${event.id}/registration-offer`);
    expect(offer.capacity.remaining).toBe(1);

    await safety.page.goto(`/events/${event.id}`);
    await expect(safety.page.getByRole("region", { name: "Venue & technical detail" })).toContainText(`${title} projector`);
    await safety.page.getByRole("button", { name: "Approve for preparation", exact: true }).click();
    await expect(safety.page.getByTestId("event-status-badge")).toHaveText("Preparation");
    await coordinator.page.reload();
    await expect(coordinator.page.getByTestId("event-status-badge")).toHaveText("Preparation");
    const { notifications } = await call(organiser, "GET", "/notifications");
    expect(notifications.some((n: { event_id: string; notification_type: string }) =>
      n.event_id === event.id && n.notification_type === "event_approved")).toBe(true);
  } finally {
    for (const actor of actors) await actor.context.close();
  }
});

test("INTEGRATED-02 real conflict and cross-owner refusals preserve the event and bookings", async ({ browser }) => {
  const actors: Actor[] = [];
  const as = async (account: string, role: string) => {
    const actor = await login(browser, account, role);
    actors.push(actor);
    return actor;
  };
  try {
    const organiser = await as("organiser.a", "Organiser");
    const outsider = await as("organiser.b", "Organiser");
    const lead = await as("coordinator-lead", "Event Coordinator Lead");
    const coordinator = await as("coordinator.a", "Coordinator");
    const staff = await as("venue-staff", "Venue Staff");
    const title = "Campus Photography Workshop";
    const first = await planningEvent(organiser, lead, coordinator, title);
    const second = await planningEvent(organiser, lead, coordinator, `${title} - Second Session`);
    const room = await venue(staff, `${title} (${first.reference})`);
    const booking = await book(coordinator, first.id, room.id);
    await call(staff, "POST", `/venues/bookings/${booking.id}/decision`, { decision: "approve" });
    const before = await call(coordinator, "GET", `/events/${second.id}`);
    await call(coordinator, "POST", "/venues/bookings", {
      event_id: second.id, venue_id: room.id, start_at: START, end_at: END,
      expected_attendance: 2, layout: "Classroom",
    }, 409);
    await call(outsider, "PATCH", `/events/${second.id}`, { title: "Stolen event" }, 403);
    expect(await call(coordinator, "GET", `/events/${second.id}`)).toEqual(before);
    const saved = await call(coordinator, "GET", `/venues/bookings/event/${first.id}`);
    expect(saved.bookings).toHaveLength(1);
    expect(saved.bookings[0].status).toBe("Confirmed");
    await coordinator.page.goto(`/events/${second.id}`);
    await expect(coordinator.page.getByRole("heading", { name: `${title} - Second Session`, exact: true })).toBeVisible();
    await coordinator.page.getByRole("button", { name: "Confirm event", exact: true }).click();
    await expect(coordinator.page.getByTestId("confirm-blocked-message")).toContainText(/No venue/i);
    await expect(coordinator.page.getByTestId("event-status-badge")).toHaveText("Planning");
  } finally {
    for (const actor of actors) await actor.context.close();
  }
});
