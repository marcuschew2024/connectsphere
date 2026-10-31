import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:5001";
const coordinators = [{ id: 2, display_name: "Coordinator A" }, { id: 3, display_name: "Coordinator B" }];
const event = (number: number, overrides = {}) => ({
  id: `event-${number}`, reference: `EVT-${String(number).padStart(3, "0")}`,
  title: `Campus event ${number}`, category: "Workshop", status: "Submitted",
  event_datetime: "2099-10-20T06:00:00Z", organiser_id: 1, coordinator_id: null,
  submitted_at: `2026-10-${String(number).padStart(2, "0")}T00:00:00Z`,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  coordinator_assigned_at: null, expected_attendance: 20, ...overrides,
});

async function setup(page: Page) {
  const rows = [
    ...Array.from({ length: 7 }, (_, index) => event(index + 1)),
    ...Array.from({ length: 8 }, (_, index) => event(index + 8, {
      coordinator_id: index % 2 ? 3 : 2, status: "Planning",
      coordinator_assigned_at: `2026-10-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
    })),
    event(16, { status: "Completed", coordinator_id: 2 }),
    event(17, { status: "Rejected" }),
    event(18, { status: "Draft", title: "Private draft must stay hidden" }),
  ];
  await page.route(`${API}/session`, route => route.fulfill({ json: { user: {
    id: 14, role: "Event Coordinator Lead", display_name: "Lead",
  } } }));
  await page.route(`${API}/events`, route => route.fulfill({ json: { events: rows } }));
  await page.route(`${API}/events/coordinators`, route => route.fulfill({ json: { coordinators } }));
  await page.route(`${API}/events/*/coordinator`, async route => {
    const id = route.request().url().split("/").at(-2);
    const row = rows.find(item => item.id === id)!;
    const outcome = row.coordinator_id === null ? "assigned" : "reassigned";
    Object.assign(row, { coordinator_id: route.request().postDataJSON().coordinator_id, coordinator_assigned_at: "2026-10-31T00:00:00Z" });
    await route.fulfill({ json: { event: row, outcome } });
  });
  return rows;
}

test("Lead overview separates work and history, with bounded independent pages", async ({ page }) => {
  await setup(page);
  await page.goto("/events/supervised");
  await expect(page.getByRole("link", { name: "Event overview", exact: true })).toHaveAttribute("href", "/events/supervised");
  await expect(page.getByRole("navigation", { name: "Event overview" })).toContainText("Assigned and active");
  const queue = page.getByRole("region", { name: "Unassigned queue" });
  const assigned = page.getByRole("region", { name: "Assigned events" });
  const past = page.getByRole("region", { name: "Past events" });
  await expect(queue.getByRole("listitem")).toHaveCount(6);
  await expect(assigned.getByRole("listitem")).toHaveCount(6);
  await expect(past.getByRole("listitem")).toHaveCount(2);
  await expect(assigned.getByRole("link", { name: "Campus event 16", exact: true })).toHaveCount(0);
  await expect(past.getByRole("button", { name: /^Reassign/ })).toHaveCount(0);
  await expect(page.getByText("Private draft must stay hidden")).toHaveCount(0);
  await queue.getByRole("button", { name: "Next", exact: true }).click();
  await expect(queue.getByRole("link", { name: "Campus event 7", exact: true })).toBeVisible();
  await expect(assigned.getByRole("listitem")).toHaveCount(6);
  await assigned.getByRole("button", { name: "Next", exact: true }).click();
  await expect(assigned.getByRole("listitem")).toHaveCount(2);
});

test("search and combined filters find one event without losing global counts", async ({ page }) => {
  await setup(page);
  await page.goto("/events/supervised");
  await page.getByLabel("Search events", { exact: true }).fill("evt-008");
  await expect(page.getByRole("link", { name: "Campus event 8", exact: true })).toBeVisible();
  await expect(page.getByText("1 of 17 events match", { exact: true })).toBeVisible();
  await page.getByLabel("Coordinator filter").selectOption("3");
  await expect(page.getByText("0 of 17 events match", { exact: true })).toBeVisible();
  await page.getByLabel("Coordinator filter").selectOption("2");
  await page.getByLabel("Status filter").selectOption("Planning");
  await expect(page.getByText("1 of 17 events match", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByLabel("Search events", { exact: true }).fill(" campus event 16 ");
  await expect(page.getByRole("region", { name: "Past events" }).getByRole("link", { name: "Campus event 16", exact: true })).toBeVisible();
});

test("an assignment remains easy to find and persists after reload", async ({ page }) => {
  await setup(page);
  await page.goto("/events/supervised");
  await page.getByLabel("Search events", { exact: true }).fill("EVT-007");
  await page.getByLabel("Assign Campus event 7 to", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Assign Campus event 7", exact: true }).click();
  const assigned = page.getByRole("region", { name: "Assigned events" });
  await expect(assigned.getByRole("link", { name: "Campus event 7", exact: true })).toBeVisible();
  await expect(assigned).toContainText("Assigned to Coordinator A");
  await expect(page.getByRole("link", { name: "Open updated event" })).toHaveAttribute("href", "/events/event-7");
  await page.reload();
  await expect(assigned.getByRole("link", { name: "Campus event 7", exact: true })).toBeVisible();
  await page.getByLabel("Coordinator filter").selectOption("2");
  await expect(assigned.getByRole("link", { name: "Campus event 7", exact: true })).toBeVisible();
});

test("failed loading can be retried and Refresh events retrieves another Lead's changes", async ({ page }) => {
  const rows = await setup(page);
  let fail = true;
  await page.route(`${API}/events`, route => fail
    ? route.fulfill({ status: 503, json: { error: "Could not load supervised events." } })
    : route.fulfill({ json: { events: rows } }));
  await page.goto("/events/supervised");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not load");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("region", { name: "Unassigned queue" })).toBeVisible();
  Object.assign(rows[0], { coordinator_id: 3, coordinator_assigned_at: "2026-11-01T00:00:00Z" });
  await page.getByRole("button", { name: "Refresh events" }).click();
  await expect(page.getByRole("region", { name: "Assigned events" }).getByRole("link", { name: "Campus event 1", exact: true })).toBeVisible();
});

test("other roles cannot load the Lead overview", async ({ page }) => {
  let reads = 0;
  await setup(page);
  await page.route(`${API}/session`, route => route.fulfill({ json: { user: { id: 2, role: "Coordinator" } } }));
  await page.route(`${API}/events`, route => { reads++; return route.fulfill({ json: { events: [] } }); });
  await page.goto("/events/supervised");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Only the Event Coordinator Lead can access this overview.");
  expect(reads).toBe(0);
});
