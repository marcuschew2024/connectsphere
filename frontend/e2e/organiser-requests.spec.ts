import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:5001";
const request = {
  id: "request-1", title: "Campus workshop", organiser_id: 1, coordinator_id: null,
  status: "Planning", request_status: "Submitted", category: "Workshop",
  event_datetime: "2099-10-20T06:00:00Z",
};

async function session(page: Page, role = "Organiser") {
  await page.route(`${API}/session`, (route) => route.fulfill({ json: {
    user: { id: 1, display_name: "Organiser A", role },
  } }));
  await page.route(`${API}/notifications`, (route) => route.fulfill({ json: { notifications: [] } }));
}

test("Home and sidebar lead to submitted requests even without notifications", async ({ page }) => {
  await session(page);
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events: [request] } }));
  await page.goto("/");
  await expect(page.getByRole("link", { name: "My requests", exact: true })).toHaveAttribute("href", "/events/mine");
  await page.getByRole("link", { name: "My submitted requests", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My requests", exact: true })).toBeVisible();
  await expect(page.getByText("Waiting for Coordinator assignment", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: request.title, exact: true })).toHaveAttribute("href", "/events/request-1");
});

test("active and past requests stay accessible while drafts and foreign records are excluded", async ({ page }) => {
  await session(page);
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events: [
    request,
    { ...request, id: "assigned", title: "Assigned workshop", coordinator_id: 2 },
    ...["Completed", "Rejected", "Cancelled"].map((status) => ({
      ...request, id: status, title: `${status} workshop`, status, request_status: status,
    })),
    { ...request, id: "draft", title: "Private draft", status: "Draft", request_status: "Draft" },
    { ...request, id: "foreign", title: "Someone else's request", organiser_id: 6 },
  ] } }));
  await page.goto("/events/mine");
  await expect(page.getByRole("region", { name: "Active requests" }).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Past requests" }).getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText("Coordinator assigned", { exact: true })).toBeVisible();
  await expect(page.getByText("Private draft", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Someone else's request", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Continue a draft" })).toHaveAttribute("href", "/events/drafts");
  for (const status of ["Completed", "Rejected", "Cancelled"]) {
    await expect(page.getByRole("link", { name: `${status} workshop`, exact: true })).toHaveAttribute("href", `/events/${status}`);
  }
});

test("empty state explains that unsubmitted drafts are separate", async ({ page }) => {
  await session(page);
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events: [
    { ...request, status: "Draft", request_status: "Draft" },
  ] } }));
  await page.goto("/events/mine");
  await expect(page.getByRole("heading", { name: "No submitted requests yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a request", exact: true })).toBeVisible();
});

test("a failed request can be retried without showing a false empty state", async ({ page }) => {
  await session(page);
  let calls = 0;
  await page.route(`${API}/events`, (route) => {
    calls++;
    return calls === 1 ? route.fulfill({ status: 503, json: { error: "Could not load requests." } })
      : route.fulfill({ json: { events: [request] } });
  });
  await page.goto("/events/mine");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Could not load requests.");
  await expect(page.getByRole("heading", { name: "No submitted requests yet" })).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("link", { name: request.title, exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

for (const role of ["Coordinator", "Attendee"]) {
  test(`${role} cannot load the Organiser workspace`, async ({ page }) => {
    await session(page, role);
    let reads = 0;
    await page.route(`${API}/events`, (route) => { reads++; return route.fulfill({ json: { events: [request] } }); });
    await page.goto("/events/mine");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Only Organisers can access requests here.");
    expect(reads).toBe(0);
  });
}

test("requests are not limited to the newest fifty notifications", async ({ page }) => {
  await session(page);
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events:
    Array.from({ length: 55 }, (_, i) => ({ ...request, id: `event-${i}`, title: `Request ${i}` })),
  } }));
  await page.goto("/events/mine");
  await expect(page.getByRole("region", { name: "Active requests" }).getByRole("listitem")).toHaveCount(55);
  await expect(page.getByRole("link", { name: "Request 54", exact: true })).toHaveAttribute("href", "/events/event-54");
});
