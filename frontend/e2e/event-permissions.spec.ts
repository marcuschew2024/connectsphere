import { expect, test } from "./fixtures";

const API = "http://localhost:5001";
const ID = "16116116-1111-4111-8111-111111111111";

// Controlled browser evidence for rendering a legitimate read-only event.
// Server authority is separately proved by INTEGRATED-05 and real-DB status tests.
for (const role of ["Attendee", "Venue Staff", "Tech Support"]) {
  test(`${role} has no event lifecycle controls even when event membership permits reading`, async ({ page }) => {
    const mutations: string[] = [];
    await page.route(`${API}/**`, route => {
      const request = route.request();
      if (request.method() !== "GET") mutations.push(request.url());
      return route.fulfill({ json: {} });
    });
    await page.route(`${API}/session`, route => route.fulfill({ json: { user: { id: 5, role } } }));
    await page.route(`${API}/events/${ID}`, route => route.fulfill({ json: { event: {
      id: ID, title: "Read-only workshop", status: "Planning", organiser_id: 1, coordinator_id: 2,
      // Staff may read related planning details; Attendee receives a public projection.
      ...(role === "Attendee" ? {} : { purpose: "Authorised staff planning", request_status: "Submitted" }),
    } } }));
    await page.route(`${API}/events/${ID}/history`, route => route.fulfill({ json: { history: [] } }));
    await page.route(`${API}/events/${ID}/clarification`, route => route.fulfill({ json: { clarification: null } }));
    await page.route(`${API}/venues/bookings/event/${ID}`, route => route.fulfill({ json: { bookings: [] } }));
    await page.goto(`/events/${ID}`);
    await expect(page.getByRole("heading", { name: "Read-only workshop", exact: true })).toBeVisible();
    await expect(page.getByTestId("event-status-badge")).toHaveText("Planning");
    await expect(page.getByRole("button", { name: /^(Approve|Reject|Confirm event|Complete event|Cancel event|Save changes)$/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View registrations →" })).toHaveCount(0);
    if (role === "Attendee") await expect(page.getByText("Authorised staff planning", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("event-status-badge")).toHaveText("Planning");
    expect(mutations).toEqual([]);
  });
}

test("forbidden page explains the role restriction and provides a way home", async ({ page }) => {
  await page.goto("/forbidden");
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  await expect(page.getByText(/current role/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to overview" })).toHaveAttribute("href", "/");
});
