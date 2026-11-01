import { expect, test, type Page } from "./fixtures";

// SCRUM-130: the Event Coordinator Lead's unassigned queue and (re)assignment.
const API = "http://localhost:5001";
const QUEUED = "13000000-0000-4000-8000-000000000001";
const ROUTED = "13000000-0000-4000-8000-000000000002";
const CLOSED = "13000000-0000-4000-8000-000000000003";

const base = {
  description: "Learn together", purpose: "Share skills", category: "Workshop",
  event_datetime: "2099-10-20T06:00:00Z", expected_attendance: 40, organiser_id: 1,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};
const coordinators = [
  { id: 2, display_name: "Demo Coordinator" },
  { id: 7, display_name: "Coordinator B" },
];

async function asLead(page: Page) {
  const events = [
    { ...base, id: QUEUED, title: "Robotics open day", status: "Submitted",
      coordinator_id: null, submitted_at: "2026-10-02T01:00:00Z" },
    { ...base, id: ROUTED, title: "Career fair", status: "Planning",
      coordinator_id: 2, submitted_at: "2026-10-01T01:00:00Z" },
    { ...base, id: CLOSED, title: "Old seminar", status: "Completed",
      coordinator_id: 7, submitted_at: "2026-09-01T01:00:00Z" },
  ];
  const posts: { id: string; body: unknown }[] = [];
  await page.route(`${API}/session`, (route) => route.fulfill({
    json: { user: { id: 8, display_name: "Demo Event Coordinator Lead", role: "Event Coordinator Lead" } },
  }));
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events } }));
  await page.route(`${API}/events/coordinators`, (route) => route.fulfill({ json: { coordinators } }));
  await page.route(`${API}/events/*/coordinator`, async (route) => {
    const id = route.request().url().split("/").at(-2)!;
    const body = route.request().postDataJSON();
    posts.push({ id, body });
    const event = events.find((row) => row.id === id)!;
    const outcome = event.coordinator_id === null ? "assigned" : "reassigned";
    event.coordinator_id = body.coordinator_id;
    await route.fulfill({ json: { event, outcome } });
  });
  return posts;
}

test("TC-130-01: the Lead sees the unassigned queue with basic event info", async ({ page }) => {
  await asLead(page);
  await page.goto("/events/supervised");

  const queue = page.getByRole("region", { name: "Unassigned queue" });
  await expect(queue.getByRole("link", { name: "Robotics open day" })).toBeVisible();
  await expect(queue).toContainText("Workshop");
  await expect(queue).toContainText("Expected attendance");
  await expect(queue).toContainText("40");
  await expect(queue.getByRole("link", { name: "Career fair" })).toHaveCount(0);
  await expect(page.getByText("3 events · 1 unassigned")).toBeVisible();
});

test("TC-130-02: the Lead assigns a queued request to a Coordinator", async ({ page }) => {
  const posts = await asLead(page);
  await page.goto("/events/supervised");

  const assign = page.getByRole("button", { name: "Assign Robotics open day" });
  await expect(assign).toBeDisabled();
  await page.getByLabel("Assign Robotics open day to").selectOption({ label: "Coordinator B" });
  await assign.click();

  await expect(page.getByRole("status").filter({ hasText: "Assigned Robotics open day to Coordinator B." })).toBeVisible();
  expect(posts).toEqual([{ id: QUEUED, body: { coordinator_id: 7 } }]);
  const assigned = page.getByRole("region", { name: "Assigned events" });
  await expect(assigned.getByRole("link", { name: "Robotics open day" })).toBeVisible();
  await expect(page.getByText("No requests are waiting for a Coordinator.")).toBeVisible();
});

test("TC-130-03: the Lead reassigns an active event; closed events cannot be moved", async ({ page }) => {
  const posts = await asLead(page);
  await page.goto("/events/supervised");

  await expect(page.getByText("Assigned to Demo Coordinator")).toBeVisible();
  const select = page.getByLabel("Reassign Career fair to");
  // The current Coordinator is not offered as a choice.
  await expect(select.locator("option", { hasText: "Demo Coordinator" })).toHaveCount(0);
  await select.selectOption({ label: "Coordinator B" });
  await page.getByRole("button", { name: "Reassign Career fair" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Reassigned Career fair to Coordinator B." })).toBeVisible();
  expect(posts).toEqual([{ id: ROUTED, body: { coordinator_id: 7 } }]);
  await expect(page.getByRole("button", { name: "Reassign Old seminar" })).toHaveCount(0);
});

test("a refused assignment is reported and nothing moves", async ({ page }) => {
  await asLead(page);
  await page.route(`${API}/events/*/coordinator`, (route) => route.fulfill({
    status: 409, json: { error: "This Coordinator is already assigned to the event." },
  }));
  await page.goto("/events/supervised");

  await page.getByLabel("Assign Robotics open day to").selectOption({ label: "Demo Coordinator" });
  await page.getByRole("button", { name: "Assign Robotics open day" }).click();

  const queue = page.getByRole("region", { name: "Unassigned queue" });
  await expect(queue.getByRole("alert")).toHaveText("This Coordinator is already assigned to the event.");
  await expect(queue.getByRole("link", { name: "Robotics open day" })).toBeVisible();
});

test("a Coordinator is notified of assignment and reassignment on Home", async ({ page }) => {
  await page.route(`${API}/session`, (route) => route.fulfill({
    json: { user: { id: 2, display_name: "Demo Coordinator", role: "Coordinator" } },
  }));
  await page.route(`${API}/notifications`, (route) => route.fulfill({ json: { notifications: [
    { id: 2, event_id: ROUTED, notification_type: "coordinator_unassigned",
      message: 'The event request "Career fair" has been reassigned to another Coordinator.',
      created_at: "2026-10-30T02:00:00Z", event: { title: "Career fair" } },
    { id: 1, event_id: QUEUED, notification_type: "coordinator_assigned",
      message: 'You have been assigned the event request "Robotics open day".',
      created_at: "2026-10-30T01:00:00Z", event: { title: "Robotics open day" } },
  ] } }));
  await page.goto("/");

  const inbox = page.getByRole("region", { name: "Notifications" });
  await expect(inbox.getByRole("heading", { name: "Event assigned to you" })).toBeVisible();
  await expect(inbox.getByRole("heading", { name: "Event reassigned" })).toBeVisible();
  // Only the event still assigned to them links through; the moved one cannot be opened.
  await expect(inbox.getByRole("link", { name: /View request/ })).toHaveCount(1);
  await expect(inbox.getByRole("link", { name: /View request/ })).toHaveAttribute("href", `/events/${QUEUED}`);
});

for (const [coordinatorId, expected] of [
  [null, "Your request is with the Event Coordinator Lead, who will assign a Coordinator to review it."],
  [2, "Your request is with the Coordinator. The decision will appear in your notifications."],
] as const) {
  test(`the Organiser sees who holds a ${coordinatorId === null ? "queued" : "assigned"} request`, async ({ page }) => {
    await page.route(`${API}/session`, (route) => route.fulfill({
      json: { user: { id: 1, display_name: "Demo Organiser", role: "Organiser" } },
    }));
    await page.route(`${API}/events/${QUEUED}`, (route) => route.fulfill({ json: { event: {
      ...base, id: QUEUED, title: "Robotics open day", status: "Planning", request_status: "Submitted",
      coordinator_id: coordinatorId, submitted_at: "2026-10-02T01:00:00Z",
      decision_at: null, decision_by: null, decision_reason: null,
    } } }));
    await page.route(`${API}/events/${QUEUED}/history`, (route) => route.fulfill({ json: { history: [] } }));
    await page.route(`${API}/events/${QUEUED}/clarification`, (route) => route.fulfill({ json: { clarification: null } }));
    await page.goto(`/events/${QUEUED}`);

    await expect(page.getByText(expected)).toBeVisible();
    await expect(page.getByText("Your request is with", { exact: false })).toHaveCount(1);
  });
}

test("the Organiser is notified once a Coordinator is assigned", async ({ page }) => {
  await page.route(`${API}/session`, (route) => route.fulfill({
    json: { user: { id: 1, display_name: "Demo Organiser", role: "Organiser" } },
  }));
  await page.route(`${API}/notifications`, (route) => route.fulfill({ json: { notifications: [
    { id: 3, event_id: QUEUED, notification_type: "request_assigned",
      message: 'A Coordinator has been assigned to your request "Robotics open day" and will review it.',
      created_at: "2026-10-30T01:00:00Z", event: { title: "Robotics open day" } },
  ] } }));
  await page.goto("/");

  const inbox = page.getByRole("region", { name: "Notifications" });
  await expect(inbox.getByRole("heading", { name: "Coordinator assigned" })).toBeVisible();
  await expect(inbox).toContainText("and will review it.");
  await expect(inbox.getByRole("link", { name: /View request/ })).toHaveAttribute("href", `/events/${QUEUED}`);
});

test("status history names the Lead's routing in words, not snake_case", async ({ page }) => {
  await page.route(`${API}/session`, (route) => route.fulfill({
    json: { user: { id: 1, display_name: "Demo Organiser", role: "Organiser" } },
  }));
  await page.route(`${API}/events/${ROUTED}`, (route) => route.fulfill({ json: { event: {
    ...base, id: ROUTED, title: "Career fair", status: "Planning", request_status: "Submitted",
    coordinator_id: 7, submitted_at: "2026-10-01T01:00:00Z",
    decision_at: null, decision_by: null, decision_reason: null,
  } } }));
  await page.route(`${API}/events/${ROUTED}/history`, (route) => route.fulfill({ json: { history: [
    { id: 1, event_id: ROUTED, old_status: "Draft", new_status: "Submitted", changed_by: 1,
      changed_at: "2026-10-01T01:00:00Z" },
    { id: 2, event_id: ROUTED, old_status: "Submitted", new_status: "Submitted", changed_by: 8,
      changed_at: "2026-10-01T02:00:00Z", action: "coordinator_assigned", note: "Assigned to Demo Coordinator" },
    { id: 3, event_id: ROUTED, old_status: "Submitted", new_status: "Submitted", changed_by: 8,
      changed_at: "2026-10-01T03:00:00Z", action: "coordinator_reassigned", note: "Assigned to Coordinator B" },
  ] } }));
  await page.route(`${API}/events/${ROUTED}/clarification`, (route) => route.fulfill({ json: { clarification: null } }));
  await page.goto(`/events/${ROUTED}`);
  await page.locator("summary").filter({ hasText: "Status history" }).click();

  await expect(page.getByText("Coordinator Assigned", { exact: true })).toBeVisible();
  await expect(page.getByText("Coordinator Reassigned", { exact: true })).toBeVisible();
  await expect(page.getByText("Assigned to Coordinator B")).toBeVisible();
  await expect(page.getByText("coordinator_assigned")).toHaveCount(0);
});

test("R11 (SCRUM-140): the Lead opens an unrelated coordinator's event detail", async ({ page }) => {
  await asLead(page);
  // The Lead's detail screen fetches event + history + clarification; all must resolve for
  // the page to render. Before R11 the clarification fetch 403'd and broke the whole page.
  await page.route(`${API}/events/${ROUTED}`, (route) => route.fulfill({ json: { event: {
    ...base, id: ROUTED, title: "Career fair", status: "Planning", request_status: "Planning",
    coordinator_id: 2, submitted_at: "2026-10-01T01:00:00Z",
  } } }));
  await page.route(`${API}/events/${ROUTED}/history`, (route) => route.fulfill({ json: { history: [] } }));
  await page.route(`${API}/events/${ROUTED}/clarification`, (route) => route.fulfill({ json: { clarification: null } }));

  await page.goto("/events/supervised");
  await page.getByRole("region", { name: "Assigned events" })
    .getByRole("link", { name: "Career fair" }).click();

  await expect(page.getByRole("heading", { name: "Career fair" })).toBeVisible();
  await expect(page.getByText("You do not have access to this event.")).toHaveCount(0);
});
