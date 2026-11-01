import { expect, test, type Page } from "./fixtures";

const API = "http://localhost:5001";
const base = {
  id: "11111111-1111-4111-8111-111111111111", reference: "EVT-101", title: "Community workshop",
  organiser_id: 1, coordinator_id: null as number | null, status: "Planning", request_status: "Submitted",
  category: "Workshop", event_datetime: "2099-10-20T06:00:00Z", updated_at: "2026-10-31T05:00:00Z",
};
async function organiser(page: Page) {
  await page.route(`${API}/session`, (route) => route.fulfill({ json: {
    user: { id: 1, role: "Organiser", display_name: "Organiser A" },
  } }));
  await page.route(`${API}/notifications`, (route) => route.fulfill({ json: { notifications: [] } }));
}

test("search and stage filters distinguish intake from arrangements under the same Planning badge", async ({ page }) => {
  await organiser(page);
  const assigned = { ...base, id: "assigned", reference: "EVT-102", title: "Robotics workshop", coordinator_id: 2 };
  const planning = { ...base, id: "planning", reference: "EVT-103", title: "Arts workshop", coordinator_id: 2, request_status: "Planning" };
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events: [base, assigned, planning] } }));
  await page.goto("/events/mine");
  await expect(page.getByRole("region", { name: "Active requests" }).getByRole("listitem")).toHaveCount(3);
  await page.getByLabel("Find a request", { exact: true }).fill("evt-102");
  await expect(page.getByRole("link", { name: "Robotics workshop", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Arts workshop", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByLabel("Request stage", { exact: true }).selectOption("arrangements");
  await expect(page.getByRole("region", { name: "Active requests" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Arts workshop", exact: true })).toBeVisible();
  await page.getByLabel("Find a request", { exact: true }).fill("No matching name");
  await expect(page.getByRole("heading", { name: "No matching requests" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page.getByRole("region", { name: "Active requests" }).getByRole("listitem")).toHaveCount(3);
});

test("event guidance updates from assignment to review and keeps the original actions discoverable", async ({ page }, testInfo) => {
  await organiser(page);
  let event = { ...base, registration_capacity: 10 };
  let clarification: { id: number; note: string; status: string } | null = null;
  await page.route(`${API}/events/${base.id}`, (route) => route.fulfill({ json: { event } }));
  await page.route(`${API}/events/${base.id}/history`, (route) => route.fulfill({ json: { history: [] } }));
  await page.route(`${API}/events/${base.id}/clarification`, (route) => route.fulfill({ json: { clarification } }));
  await page.route(`${API}/events/${base.id}/change-requests`, (route) => route.fulfill({ json: { change_requests: [] } }));
  await page.route(`${API}/venues/bookings/event/${base.id}`, (route) => route.fulfill({ json: { bookings: [] } }));
  await page.goto(`/events/${base.id}`);
  const guidance = page.getByRole("region", { name: "What happens next" });
  await expect(guidance).toContainText("Awaiting assignment");
  await expect(guidance).not.toContainText("Attendees can find this event");
  await expect(page.getByRole("link", { name: "View registrations →", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to my requests" })).toHaveAttribute("href", "/events/mine");
  await expect(page.getByRole("navigation", { name: "Event sections" }).getByRole("link", { name: "Capacity & signups" })).toHaveAttribute("href", "#registration-capacity-heading");
  event = { ...event, coordinator_id: 2 };
  await page.reload();
  await expect(guidance).toContainText("Coordinator review");
  await expect(guidance).toContainText("The decision will appear in your notifications");
  await page.screenshot({ path: testInfo.outputPath("request-detail-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("request-detail-mobile.png"), fullPage: true });
  // A historical clarification must not turn a closed event into a next action.
  event = { ...event, status: "Cancelled", request_status: "Cancelled" };
  clarification = { id: 1, note: "Earlier clarification", status: "Pending" };
  await page.reload();
  await expect(guidance).toContainText("This event will not take place");
  await expect(guidance).not.toContainText("Your response is needed");
});

test("the request form explains submission and stays usable on mobile", async ({ page }, testInfo) => {
  await organiser(page);
  await page.goto("/events/new");
  await expect(page.getByRole("list", { name: "Request process" })).toBeVisible();
  await expect(page.getByLabel("Event name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit request", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as draft", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("request-form-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Save as draft", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("request-form-mobile.png"), fullPage: true, animations: "disabled" });
});
