import { expect, test, type Page } from "./fixtures";

// SCRUM-155: every notification link opens a page its recipient can access, and a
// registered attendee sees that their event was cancelled.
const API = "http://localhost:5001";
const EVENT_ID = "15500000-0000-4000-8000-000000000001";

function notice(type: string, message: string) {
  return { id: 1, event_id: EVENT_ID, notification_type: type, message,
    created_at: "2026-10-31T10:00:00Z", event: { title: "Test Event 01" } };
}

async function signIn(page: Page, id: number, role: string) {
  await page.route(`${API}/session`, (route) => route.fulfill({ json: { user: { id, role, display_name: `Demo ${role}` } } }));
}

const SUBJECT = "15500000-0000-4000-8000-000000000009";

for (const [role, type, label, href] of [
  ["Tech Support", "equipment_request_submitted", "Review this equipment request", `/equipment/requests/${SUBJECT}`],
  ["Venue Staff", "venue_booking_requested", "Review this booking request", `/venues/bookings/${SUBJECT}`],
] as const) {
  test(`${role} opens the exact request a notification is about`, async ({ page }) => {
    await signIn(page, role === "Tech Support" ? 4 : 3, role);
    await page.route(`${API}/notifications`, (route) => route.fulfill({ json: { notifications: [
      { ...notice(type, "A new request needs review."), subject_id: SUBJECT },
    ] } }));
    await page.goto("/");

    const inbox = page.getByRole("region", { name: "Notifications" });
    const link = inbox.getByRole("link", { name: new RegExp(label) });
    await expect(link).toHaveAttribute("href", href);
    // The old link to the event page (which these roles cannot open) is gone.
    await expect(inbox.locator(`a[href="/events/${EVENT_ID}"]`)).toHaveCount(0);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  });
}

test("an older pool notice without a subject still opens the review queue", async ({ page }) => {
  await signIn(page, 3, "Venue Staff");
  await page.route(`${API}/notifications`, (route) => route.fulfill({ json: { notifications: [
    notice("venue_booking_requested", "Venue booking requested for Test Event 01."),
  ] } }));
  await page.goto("/");

  await expect(page.getByRole("region", { name: "Notifications" }).getByRole("link", { name: /Review booking requests/ }))
    .toHaveAttribute("href", "/venues/bookings");
});

test("a Coordinator's request notification still opens the event", async ({ page }) => {
  await signIn(page, 2, "Coordinator");
  await page.route(`${API}/notifications`, (route) => route.fulfill({ json: { notifications: [
    notice("event_change_request", "The organiser submitted a change request for your event."),
  ] } }));
  await page.goto("/");

  await expect(page.getByRole("region", { name: "Notifications" }).getByRole("link", { name: /View request/ }))
    .toHaveAttribute("href", `/events/${EVENT_ID}`);
});

test("a registered attendee sees their event was cancelled", async ({ page }) => {
  await signIn(page, 5, "Attendee");
  await page.route(`${API}/events/registration-confirmations`, (route) => route.fulfill({ json: { confirmations: [
    notice("event_cancelled", 'The event "Test Event 01" you registered for has been cancelled.'),
  ] } }));
  await page.goto("/");

  const panel = page.getByRole("region", { name: "Registration confirmations" });
  await expect(panel.getByRole("heading", { name: "Event cancelled" })).toBeVisible();
  await expect(panel.getByRole("link", { name: /View my registrations/ })).toHaveAttribute("href", "/registrations");
});
