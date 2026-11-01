import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:5001";
const ID = "22222222-2222-4222-8222-222222222222";
const event = {
  id: ID, title: "Campus open day", status: "Confirmed", request_status: "Confirmed",
  event_datetime: "2099-10-20T06:00:00Z", expected_attendance: 300,
  venue_requirements: "Main hall", accessibility_requirements: "Step-free access",
  facility_requirements: "Projector, Microphone", equipment_requirements: "PA system",
  organiser_id: 1, coordinator_id: 2,
};

async function session(page: Page, role = "Safety Officer") {
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: 8, display_name: `Demo ${role}`, role },
  } }));
}

test("Safety Officer can navigate from home to the queue and approve without clarification access", async ({ page }) => {
  await session(page);
  await page.route(`${API}/events/safety-review?*`, (route) => route.fulfill({
    json: { events: [event], page: 1, has_more: false },
  }));
  await page.route(`${API}/events/${ID}`, (route) => route.fulfill({ json: { event } }));
  await page.route(`${API}/events/${ID}/history`, (route) => route.fulfill({ json: { history: [] } }));
  let clarificationRequests = 0;
  await page.route(`${API}/events/${ID}/clarification`, (route) => {
    clarificationRequests++;
    return route.fulfill({ status: 403, json: { error: "Not permitted" } });
  });
  await page.route(`${API}/events/${ID}/safety-check`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ decision: "approve" });
    return route.fulfill({ json: { event: { ...event, status: "Preparation" } } });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Review operational safety" }).click();
  await expect(page.getByRole("heading", { name: "Operational safety reviews" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Campus open day" })).toBeVisible();
  await page.screenshot({ path: "test-results/safety-queue-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/safety-queue-mobile.png", fullPage: true });
  await page.getByRole("link", { name: /Campus open day/ }).click();
  await expect(page.getByText("Projector, Microphone")).toBeVisible();
  await expect(page.getByText("PA system").first()).toBeVisible();
  await page.getByRole("button", { name: "Approve for preparation" }).click();
  await expect(page.getByTestId("event-status-badge")).toHaveText("Preparation");
  expect(clarificationRequests).toBe(0);
});

test("queue can page and shows an empty result", async ({ page }) => {
  await session(page);
  await page.route(`${API}/events/safety-review?*`, (route) => {
    const second = route.request().url().endsWith("page=2");
    return route.fulfill({ json: { events: second ? [] : [event], has_more: !second } });
  });
  await page.goto("/events/safety");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("There are no confirmed events awaiting safety review.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Campus open day" })).toBeVisible();
});

test("other roles cannot open the queue or see safety navigation", async ({ page }) => {
  await session(page, "Coordinator");
  let queueRequests = 0;
  await page.route(`${API}/events/safety-review?*`, (route) => {
    queueRequests++;
    return route.fulfill({ status: 403, json: { error: "Forbidden" } });
  });
  await page.goto("/events/safety");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Only Safety Officers");
  await expect(page.getByRole("link", { name: "Safety reviews", exact: true })).toHaveCount(0);
  expect(queueRequests).toBe(0);
});

test("queue displays API failure without implying that no reviews exist", async ({ page }) => {
  await session(page);
  await page.route(`${API}/events/safety-review?*`, (route) => route.fulfill({
    status: 503, json: { error: "Could not load safety reviews. Please try again." },
  }));
  await page.goto("/events/safety");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not load safety reviews");
  await expect(page.getByText("There are no confirmed events awaiting safety review.")).toHaveCount(0);
});
