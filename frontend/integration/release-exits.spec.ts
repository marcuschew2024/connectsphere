import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";
const WEB = process.env.QA_WEB_URL ?? "http://localhost:3107";
const API = process.env.QA_API_URL ?? "http://localhost:5001";
const START = "2099-10-20T06:00:00Z", END = "2099-10-20T07:00:00Z";
type Actor = { context: BrowserContext; page: Page; id: number };
type Login = (account: string, role: string) => Promise<Actor>;
const test = base.extend<{ as: Login }>({ as: async ({ browser }, provide) => {
  const contexts: BrowserContext[] = [];
  try { await provide(async (account, role) => {
    const context = await browser.newContext({ baseURL: WEB, timezoneId: "Asia/Singapore" }); contexts.push(context);
    const page = await context.newPage(); await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(`${account}@connectsphere.test`);
    await page.getByLabel("Password", { exact: true }).fill("disposable-test-only-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${WEB}/`);
    const session = await context.request.get(`${API}/session`, { headers: { Origin: WEB } });
    expect(session.status()).toBe(200); const { user } = await session.json(); expect(user.role).toBe(role);
    return { context, page, id: user.id };
  }); } finally { await Promise.all(contexts.map(context => context.close())); }
} });
async function call(actor: Actor, method: string, path: string, data?: unknown, status = 200) {
  const response = await actor.context.request.fetch(`${API}${path}`, { method, data, headers: { Origin: WEB } });
  expect(response.status(), `${method} ${path}: ${await response.text()}`).toBe(status); return response.json();
}
async function venue(staff: Actor, name: string) {
  return (await call(staff, "POST", "/venues", { name, location: "Release verification campus", capacity: 30,
    facilities: ["Projector"], accessibility: ["Wheelchair"], supported_layouts: ["Classroom"],
    operating_hours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
      .map(day => [day, { opens: "00:00", closes: "23:59" }])) }, 201)).venue;
}
async function setup(as: Login) {
  const organiser = await as("organiser.a", "Organiser"), lead = await as("coordinator-lead", "Event Coordinator Lead"),
    coordinator = await as("coordinator.a", "Coordinator"), staff = await as("venue-staff", "Venue Staff");
  const title = `Release verification ${crypto.randomUUID()}`;
  const { event } = await call(organiser, "POST", "/events", { action: "submit", title,
    description: "Release lifecycle evidence", purpose: "Private organising notes", category: "Workshop",
    event_datetime: START, event_end_datetime: END, expected_attendance: 2 }, 201);
  await call(lead, "POST", `/events/${event.id}/coordinator`, { coordinator_id: coordinator.id });
  await call(coordinator, "POST", `/events/${event.id}/decision`, { decision: "approve" });
  const room = await venue(staff, title);
  const { booking } = await call(coordinator, "POST", "/venues/bookings", { event_id: event.id, venue_id: room.id,
    start_at: START, end_at: END, expected_attendance: 2, layout: "Classroom" }, 201);
  await call(staff, "POST", `/venues/bookings/${booking.id}/decision`, { decision: "approve" });
  return { organiser, lead, coordinator, staff, event, booking, room };
}
async function allocate(tech: Actor, coordinator: Actor, eventId: string) {
  const { equipment } = await call(tech, "POST", "/equipment", { equipment_type: `Projector ${crypto.randomUUID()}`,
    description: "Verification stock", total_quantity: 1, location: "QA store", operational_status: "Operational" }, 201);
  const { request } = await call(coordinator, "POST", "/equipment/requests", { event_id: eventId,
    items: [{ equipment_id: equipment.id, quantity: 1, technical_notes: "HDMI" }] }, 201);
  await call(tech, "PUT", `/equipment/requests/${request.id}/reservations`, { start_at: START, end_at: END,
    revision: request.revision, notes: "Ready", items: [{ equipment_id: equipment.id, quantity: 1 }] });
  return equipment;
}

for (const [part, blockStart, blockEnd, calendarCell] of [
  ["setup", "13:45", "14:00", "Tue 1pm: Blocked"],
  ["turnaround", "15:00", "15:30", "Tue 3pm: Blocked"],
] as const) {
  test(`INTEGRATED-R5 ${part}-only maintenance notifies and supports a replacement`, async ({ as }) => {
    const { coordinator, staff, event, booking, room } = await setup(as);
    await call(staff, "PUT", `/venues/${room.id}`, {
      revision: room.revision, setup_time_minutes: 30, turnaround_time_minutes: 45,
      capacity: room.capacity, facilities: room.facilities, accessibility: room.accessibility,
      supported_layouts: room.supported_layouts, operating_hours: room.operating_hours,
    });
    const sibling = await venue(staff, `Unaffected ${event.reference}`);
    const { booking: other } = await call(coordinator, "POST", "/venues/bookings", {
      event_id: event.id, venue_id: sibling.id, start_at: START, end_at: END,
      expected_attendance: 2, layout: "Classroom",
    }, 201);
    await call(staff, "POST", `/venues/bookings/${other.id}/decision`, { decision: "approve" });

    await staff.page.goto(`/venues/${room.id}?date=2099-10-20`);
    await staff.page.getByLabel("Start", { exact: true }).fill(`2099-10-20T${blockStart}`);
    await staff.page.getByLabel("End", { exact: true }).fill(`2099-10-20T${blockEnd}`);
    await staff.page.getByLabel("Reason", { exact: true }).selectOption("Maintenance");
    const blocked = staff.page.waitForResponse(r => r.url().endsWith(`/venues/${room.id}/unavailability`) && r.request().method() === "POST");
    await staff.page.getByRole("button", { name: "Block venue", exact: true }).click();
    const response = await blocked;
    expect(response.status()).toBe(201);
    const result = await response.json();
    expect(result.affected_booking_ids).toEqual([booking.id]);
    await staff.page.reload();
    await expect(staff.page.getByRole("cell", { name: calendarCell, exact: true })).toBeVisible();

    const search = await call(coordinator, "GET", "/venues?date=2099-10-20&start_time=14:00&end_time=15:00&location=Release%20verification%20campus");
    // Catalogue pages may contain earlier test venues: find this room across all pages.
    let candidates = search.venues;
    for (let page = 2, more = search.has_more; more; page++) {
      const next = await call(coordinator, "GET", `/venues?date=2099-10-20&start_time=14:00&end_time=15:00&location=Release%20verification%20campus&page=${page}`);
      candidates = candidates.concat(next.venues); more = next.has_more;
    }
    expect(candidates.find((v: { id: string }) => v.id === room.id).search_availability).toBe("blocked");
    await coordinator.page.goto("/");
    const notice = coordinator.page.getByRole("listitem").filter({ hasText: event.title }).filter({ hasText: "maintenance block" });
    await expect(notice).toHaveCount(1);
    await notice.getByRole("link", { name: "View request" }).click();
    await expect(coordinator.page).toHaveURL(`${WEB}/events/${event.id}`);
    expect((await call(staff, "GET", `/venues/bookings/${booking.id}`)).booking.status).toBe("Confirmed");

    const replacement = await venue(staff, `Replacement R5 ${event.reference}`);
    await coordinator.page.goto("/venues/bookings/new");
    await coordinator.page.getByRole("combobox", { name: "Event", exact: true }).selectOption(event.id);
    await coordinator.page.getByRole("combobox", { name: "Venue", exact: true }).selectOption(replacement.id);
    await coordinator.page.getByLabel("Expected attendance").fill("2");
    await coordinator.page.getByRole("checkbox", { name: "Classroom", exact: true }).check();
    await coordinator.page.getByLabel("Start", { exact: true }).fill("2099-10-20T14:00");
    await coordinator.page.getByLabel("End", { exact: true }).fill("2099-10-20T15:00");
    const submitted = coordinator.page.waitForResponse(r => r.url() === `${API}/venues/bookings` && r.request().method() === "POST");
    await coordinator.page.getByRole("button", { name: "Submit booking request" }).click();
    const saved = await submitted; expect(saved.status()).toBe(201);
    const { booking: replacementBooking } = await saved.json();
    await staff.page.goto(`/venues/bookings/${replacementBooking.id}`);
    await staff.page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(staff.page.getByRole("heading", { name: "Booking confirmed" })).toBeVisible();
    await call(coordinator, "POST", `/venues/bookings/${booking.id}/cancel`);
    await coordinator.page.goto(`/events/${event.id}`);
    await expect(coordinator.page.getByText(replacement.name, { exact: true })).toBeVisible();
    expect((await call(staff, "GET", `/venues/bookings/${other.id}`)).booking.status).toBe("Confirmed");
    const current = (await call(coordinator, "GET", `/events/${event.id}`)).event;
    expect(current.title).toBe(event.title); expect(current.description).toBe(event.description);
    expect(current.status).toBe("Planning");
    await call(staff, "DELETE", `/venues/${room.id}/unavailability/${result.block.id}`);
  });
}

test("INTEGRATED-06 cancellation releases resources and the attendee follows the real notification", async ({ as }) => {
  const { organiser, coordinator, staff, event, booking } = await setup(as);
  const tech = await as("tech-support", "Tech Support"), attendee = await as("attendee.a", "Attendee");
  const equipment = await allocate(tech, coordinator, event.id);
  await call(organiser, "PUT", `/events/${event.id}/registration-capacity`, { capacity: 2 });
  await call(coordinator, "POST", `/events/${event.id}/confirm`);
  await call(attendee, "POST", `/events/${event.id}/registrations`, {}, 201);
  await coordinator.page.goto(`/events/${event.id}`);
  await coordinator.page.getByText("Cancel event", { exact: true }).click();
  await coordinator.page.getByLabel("Reason for cancelling").fill("Speaker unavailable");
  await coordinator.page.getByRole("button", { name: "Continue to cancellation" }).click();
  await coordinator.page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(coordinator.page.getByTestId("event-status-badge")).toHaveText("Cancelled");
  await coordinator.page.reload(); await expect(coordinator.page.getByTestId("event-status-badge")).toHaveText("Cancelled");
  expect((await call(staff, "GET", `/venues/bookings/${booking.id}`)).booking.status).toBe("Cancelled");
  const availability = await call(tech, "GET", `/equipment/${equipment.id}/availability?start_at=${START}&end_at=${END}&quantity=1`);
  expect(availability.availability.available_quantity).toBe(1);
  const { notifications } = await call(attendee, "GET", "/notifications");
  expect(notifications.filter((notice: { event_id: string; notification_type: string }) => notice.event_id === event.id && notice.notification_type === "event_cancelled")).toHaveLength(1);
  await attendee.page.goto("/");
  const notice = attendee.page.getByRole("listitem").filter({ hasText: event.title });
  await notice.getByRole("link", { name: "View my registrations" }).click();
  await expect(attendee.page).toHaveURL(`${WEB}/registrations`);
  await expect(attendee.page.getByRole("listitem").filter({ hasText: event.title }).getByText("Event cancelled", { exact: true })).toBeVisible();
  await call(coordinator, "PATCH", `/events/${event.id}`, { title: "Forbidden edit" }, 409);
});

test("INTEGRATED-07 safety approval leads to completion, persisted closure and released resources", async ({ as }) => {
  const { coordinator, staff, event, booking } = await setup(as);
  const tech = await as("tech-support", "Tech Support"), safety = await as("safety-officer", "Safety Officer");
  const equipment = await allocate(tech, coordinator, event.id);
  await call(coordinator, "POST", `/events/${event.id}/confirm`);
  await safety.page.goto(`/events/${event.id}`);
  await safety.page.getByRole("button", { name: "Approve for preparation" }).click();
  await expect(safety.page.getByTestId("event-status-badge")).toHaveText("Preparation");
  await coordinator.page.goto(`/events/${event.id}`);
  await coordinator.page.getByLabel("Post-event notes (optional)").fill("Delivered successfully");
  await coordinator.page.getByRole("button", { name: "Mark event complete" }).click();
  await coordinator.page.getByRole("button", { name: "Confirm completion" }).click();
  await expect(coordinator.page.getByRole("heading", { name: "Event completed and closed" })).toBeVisible();
  await coordinator.page.reload(); await expect(coordinator.page.getByTestId("event-status-badge")).toHaveText("Completed");
  await expect(coordinator.page.getByRole("button", { name: "Mark event complete" })).toHaveCount(0);
  expect((await call(staff, "GET", `/venues/bookings/${booking.id}`)).booking.status).toBe("Cancelled");
  expect((await call(tech, "GET", `/equipment/${equipment.id}/availability?start_at=${START}&end_at=${END}&quantity=1`)).availability.available_quantity).toBe(1);
  const { history } = await call(coordinator, "GET", `/events/${event.id}/history`);
  expect(history.some((row: { action: string; note: string }) => row.action === "event_completed" && row.note === "Delivered successfully")).toBe(true);
});

test("INTEGRATED-08 venue unavailability notifies the Coordinator and a replacement preserves the event", async ({ as }) => {
  const { coordinator, staff, event, booking, room } = await setup(as);
  const { block } = await call(staff, "POST", `/venues/${room.id}/unavailability`, {
    start_at: START, end_at: END, reason: "Maintenance", note: "Emergency repairs" }, 201);
  const { notifications } = await call(coordinator, "GET", "/notifications");
  expect(notifications.filter((row: { event_id: string; notification_type: string }) => row.event_id === event.id && row.notification_type === "venue_unavailable")).toHaveLength(1);
  await coordinator.page.goto("/");
  const notice = coordinator.page.getByRole("listitem").filter({ hasText: /maintenance block/ }).filter({ hasText: event.title });
  await notice.getByRole("link", { name: "View request" }).click();
  await expect(coordinator.page).toHaveURL(`${WEB}/events/${event.id}`);
  expect((await call(staff, "GET", `/venues/bookings/${booking.id}`)).booking.status).toBe("Confirmed");
  const replacement = await venue(staff, `Replacement ${event.reference}`);
  const { booking: next } = await call(coordinator, "POST", "/venues/bookings", { event_id: event.id,
    venue_id: replacement.id, start_at: START, end_at: END, expected_attendance: 2, layout: "Classroom" }, 201);
  await call(staff, "POST", `/venues/bookings/${next.id}/decision`, { decision: "approve" });
  await call(coordinator, "POST", `/venues/bookings/${booking.id}/cancel`);
  await coordinator.page.reload();
  await expect(coordinator.page.getByText(replacement.name, { exact: true })).toBeVisible();
  const stored = (await call(coordinator, "GET", `/events/${event.id}`)).event;
  expect(stored.title).toBe(event.title); expect(stored.status).toBe("Planning");
  await call(staff, "DELETE", `/venues/${room.id}/unavailability/${block.id}`);
});

test("INTEGRATED-09 Lead reassignment removes the old Coordinator's action access", async ({ as }) => {
  const { lead, coordinator, event } = await setup(as);
  const next = await as("coordinator.b", "Coordinator");
  await lead.page.goto("/events/supervised"); await lead.page.getByLabel("Search events", { exact: true }).fill(event.reference);
  const card = lead.page.getByRole("listitem").filter({ has: lead.page.locator(`a[href="/events/${event.id}"]`) });
  await card.getByLabel(`Reassign ${event.title} to`, { exact: true }).selectOption(String(next.id));
  await card.getByRole("button", { name: `Reassign ${event.title}`, exact: true }).click();
  await expect(card).toContainText("Coordinator B");
  await coordinator.page.goto(`/events/${event.id}`);
  await expect(coordinator.page.getByText("You do not have access to this event.", { exact: true })).toBeVisible();
  await call(coordinator, "PATCH", `/events/${event.id}`, { title: "Forged change" }, 403);
  await next.page.goto(`/events/${event.id}`); await expect(next.page.getByTestId("event-status-badge")).toHaveText("Planning");
  const stored = (await call(next, "GET", `/events/${event.id}`)).event;
  expect(stored.coordinator_id).toBe(next.id); expect(stored.title).toBe(event.title);
});

test("INTEGRATED-10 significant change persists through re-review and implementation without cancelling resources", async ({ as }) => {
  const { organiser, coordinator, staff, event, booking } = await setup(as);
  const tech = await as("tech-support", "Tech Support");
  const equipment = await allocate(tech, coordinator, event.id);
  await organiser.page.goto(`/events/${event.id}`);
  await organiser.page.getByLabel("Describe the desired change").fill("Larger workshop group");
  await organiser.page.getByText("Propose new values (optional)").click();
  await organiser.page.getByLabel("New expected attendance").fill("3");
  await organiser.page.getByRole("button", { name: "Request a change", exact: true }).click();
  await expect(organiser.page.getByTestId("change-request-status-badge")).toHaveText("Pending");
  await coordinator.page.goto(`/events/${event.id}`);
  await coordinator.page.getByRole("button", { name: "Approve and apply" }).click();
  await expect(coordinator.page.getByTestId("change-request-status-badge")).toHaveText("Approved · Re-review in progress");
  await coordinator.page.reload();
  await expect(coordinator.page.getByTestId("change-request-status-badge")).toHaveText("Approved · Re-review in progress");
  expect((await call(coordinator, "GET", `/events/${event.id}`)).event.expected_attendance).toBe(3);
  expect((await call(staff, "GET", `/venues/bookings/${booking.id}`)).booking.status).toBe("Confirmed");
  expect((await call(tech, "GET", `/equipment/${equipment.id}/availability?start_at=${START}&end_at=${END}&quantity=1`)).availability.available_quantity).toBe(0);
  await coordinator.page.getByRole("button", { name: "Mark as implemented" }).click();
  await coordinator.page.getByRole("button", { name: "Not yet", exact: true }).click();
  expect((await call(coordinator, "GET", `/events/${event.id}/change-requests`)).change_requests[0].status).toBe("Approved");
  await coordinator.page.getByRole("button", { name: "Mark as implemented" }).click();
  await coordinator.page.getByRole("button", { name: "Yes, re-review complete" }).click();
  await expect(coordinator.page.getByTestId("change-request-status-badge")).toHaveText("Implemented");
  await organiser.page.reload();
  await expect(organiser.page.getByTestId("change-request-status-badge")).toHaveText("Implemented");
  expect((await call(organiser, "GET", `/events/${event.id}/change-requests`)).change_requests[0].status).toBe("Implemented");
});

test("INTEGRATED-11 clarification resubmits the same request and rejection preserves the reason", async ({ as }) => {
  const organiser = await as("organiser.a", "Organiser"), lead = await as("coordinator-lead", "Event Coordinator Lead"),
    coordinator = await as("coordinator.a", "Coordinator");
  const { event } = await call(organiser, "POST", "/events", { action: "submit", title: `Clarification ${crypto.randomUUID()}`,
    description: "Workshop", purpose: "Learning", category: "Workshop", event_datetime: START, event_end_datetime: END, expected_attendance: 2 }, 201);
  await call(lead, "POST", `/events/${event.id}/coordinator`, { coordinator_id: coordinator.id });
  await coordinator.page.goto(`/events/${event.id}`);
  await coordinator.page.locator("summary").filter({ hasText: "Request clarification" }).click();
  await coordinator.page.getByLabel("Clarification note").fill("Please describe the workshop activities");
  await coordinator.page.getByRole("button", { name: "Return for clarification" }).click();
  await expect(coordinator.page.getByTestId("clarification-confirmation")).toContainText("Please describe the workshop activities");
  await organiser.page.goto(`/events/${event.id}`);
  await organiser.page.getByLabel("Description *", { exact: true }).fill("Students build and demonstrate a working robot");
  await organiser.page.getByRole("button", { name: "Revise and resubmit" }).click();
  await expect(organiser.page.getByRole("heading", { name: "Changes requested" })).toHaveCount(0);
  await organiser.page.reload();
  const revised = (await call(organiser, "GET", `/events/${event.id}`)).event;
  expect(revised.reference).toBe(event.reference);
  // Organiser reads expose the public Planning stage plus the canonical request state.
  expect(revised.status).toBe("Planning"); expect(revised.request_status).toBe("Submitted");
  expect(revised.description).toBe("Students build and demonstrate a working robot");
  await coordinator.page.reload();
  await coordinator.page.getByLabel("Rejection reason", { exact: true }).fill("No available supervision for this activity");
  await coordinator.page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(coordinator.page.getByTestId("event-status-badge")).toHaveText("Rejected");
  await organiser.page.reload();
  await expect(organiser.page.getByTestId("event-status-badge")).toHaveText("Rejected");
  await expect(organiser.page.getByText("No available supervision for this activity", { exact: true })).toBeVisible();
  await expect(organiser.page.getByRole("button", { name: "Revise and resubmit" })).toHaveCount(0);
});

// Real browser -> Flask -> PostgREST -> PostgreSQL. No mocked HTTP responses.
test("INTEGRATED-R1 buffer edit flags existing conflicts while new bookings stay protected", async ({ as }) => {
  const { organiser, lead, coordinator, staff, event, booking, room } = await setup(as);
  const editable = { capacity: room.capacity, facilities: room.facilities, accessibility: room.accessibility,
    supported_layouts: room.supported_layouts, operating_hours: room.operating_hours };
  await call(staff, "PUT", `/venues/${room.id}`, { ...editable, revision: room.revision,
    setup_time_minutes: 15, turnaround_time_minutes: 30 });
  const { event: later } = await call(organiser, "POST", "/events", { action: "submit",
    title: `Later ${crypto.randomUUID()}`, description: "Buffer regression", purpose: "Learning", category: "Workshop",
    event_datetime: "2099-10-20T08:00:00Z", event_end_datetime: "2099-10-20T09:00:00Z", expected_attendance: 2 }, 201);
  await call(lead, "POST", `/events/${later.id}/coordinator`, { coordinator_id: coordinator.id });
  await call(coordinator, "POST", `/events/${later.id}/decision`, { decision: "approve" });
  const { booking: next } = await call(coordinator, "POST", "/venues/bookings", { event_id: later.id,
    venue_id: room.id, start_at: "2099-10-20T08:00:00Z", end_at: "2099-10-20T09:00:00Z",
    expected_attendance: 2, layout: "Classroom" }, 201);
  await call(staff, "POST", `/venues/bookings/${next.id}/decision`, { decision: "approve" });

  await staff.page.goto(`/venues/${room.id}/edit`);
  await staff.page.getByLabel("Turnaround buffer (mins)").fill("60");
  await staff.page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(staff.page.getByRole("heading", { name: "Venue updated", exact: true })).toBeVisible();
  const conflicts = staff.page.locator("section[aria-labelledby='buffer-conflicts-heading']");
  await expect(conflicts).toContainText(event.title);
  await expect(conflicts).toContainText(later.title);
  const report = await call(staff, "GET", `/venues/${room.id}/buffer-conflicts`);
  expect(new Set(report.buffer_conflicts.map((row: { booking_id: string }) => row.booking_id)))
    .toEqual(new Set([booking.id, next.id]));
  for (const id of [booking.id, next.id]) {
    expect((await call(staff, "GET", `/venues/bookings/${id}`)).booking.status).toBe("Confirmed");
  }
  const calendar = await call(coordinator, "GET", `/venues/${room.id}/bookings?from=2099-10-20T09:45:00Z&to=2099-10-20T10:00:00Z`);
  const occupied = calendar.bookings.find((row: { id: string }) => row.id === next.id);
  expect(occupied.occupied_end).toBe("2099-10-20T10:00:00+00:00");
  await coordinator.page.goto(`/venues/${room.id}?date=2099-10-20`);
  await expect(coordinator.page.getByRole("region", { name: "Venue availability" })).toBeVisible();

  await call(coordinator, "POST", "/venues/bookings", { event_id: later.id, venue_id: room.id,
    start_at: "2099-10-20T10:00:00Z", end_at: "2099-10-20T11:00:00Z",
    expected_attendance: 2, layout: "Classroom" }, 409);
  const { booking: boundary } = await call(coordinator, "POST", "/venues/bookings", { event_id: later.id,
    venue_id: room.id, start_at: "2099-10-20T10:15:00Z", end_at: "2099-10-20T11:15:00Z",
    expected_attendance: 2, layout: "Classroom" }, 201);
  await call(staff, "POST", `/venues/bookings/${boundary.id}/decision`, { decision: "approve" });
  await staff.page.goto(`/venues/${room.id}/edit`);
  await expect(staff.page.getByLabel("Turnaround buffer (mins)")).toHaveValue("60");
  await staff.page.getByLabel("Turnaround buffer (mins)").fill("30");
  await staff.page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(staff.page.getByRole("heading", { name: "Venue updated", exact: true })).toBeVisible();
  expect((await call(staff, "GET", `/venues/${room.id}/buffer-conflicts`)).buffer_conflicts).toEqual([]);
});
