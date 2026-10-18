import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:5001";
const ID = "44444444-4444-4444-8444-444444444444";
const PATH = `/equipment/requests/${ID}`;
const initial = {
  id: ID, event_id: "11111111-1111-4111-8111-111111111111",
  status: "Requested", revision: 1, update_notes: "", updated_by: null as number | null,
  updated_at: null as string | null, requested_by: 2, requested_at: "2026-10-18T06:00:00Z",
  routed_to: "Tech Support", requester: { display_name: "Demo Coordinator" },
  event: { id: "11111111-1111-4111-8111-111111111111", title: "Community workshop", event_datetime: "2099-10-20T06:00:00Z", status: "Planning" },
  items: [{ equipment_id: "22222222-2222-4222-8222-222222222222", equipment_type: "Wireless microphone", location: "AV store", quantity: 2, position: 1, technical_notes: "Spare batteries" }],
};
const entry = { request_id: ID, revision: 2, from_status: "Requested", status: "Reserved", notes: "Two microphones arranged", actor_id: 4, actor_name: "Demo Tech Support", changed_at: "2026-10-18T08:00:00Z" };

async function session(page: Page, role: string | null = "Tech Support") {
  await page.route(API + "/session", route => route.fulfill({ json: { user: role ? { id: role === "Coordinator" ? 2 : 4, role } : null } }));
}

test("Tech Support updates arrangements; Coordinator sees status and audit after reload", async ({ page }, testInfo) => {
  await session(page);
  let saved = { ...initial };
  const history: typeof entry[] = [];
  await page.route(API + "/equipment/requests?*", route => route.fulfill({ json: { requests: [saved], has_more: false } }));
  await page.route(API + PATH, route => route.fulfill({ json: { request: saved } }));
  await page.route(API + PATH + "/history?*", route => route.fulfill({ json: { history: [...history].reverse(), has_more: false } }));
  await page.route(API + PATH + "/status", async route => {
    const body = route.request().postDataJSON();
    expect(Object.keys(body).sort()).toEqual(["notes", "revision", "status"]);
    expect(body.revision).toBe(saved.revision);
    history.push({ ...entry, revision: saved.revision + 1, from_status: saved.status, status: body.status, notes: body.notes });
    saved = { ...saved, status: body.status, update_notes: body.notes, revision: saved.revision + 1, updated_by: 4, updated_at: entry.changed_at };
    await route.fulfill({ json: { request: saved } });
  });
  await page.goto("/equipment/requests");
  await page.getByRole("link", { name: "Review request", exact: true }).click();
  await expect(page.getByRole("region", { name: "Request details" })).toContainText("Spare batteries");
  await expect(page.getByRole("button", { name: "Save status" })).toBeDisabled();
  for (const status of ["Reserved", "Partially fulfilled", "Unavailable", "Requested"]) {
    await page.getByLabel("New status").selectOption(status);
    await page.getByLabel("Update notes (optional)").fill(`Arrangement: ${status}`);
    await page.getByRole("button", { name: "Save status" }).click();
    await expect(page.getByRole("region", { name: "Request details" })).toContainText(`Current status: ${status}`);
    await expect(page.getByRole("region", { name: "Status history" }).getByRole("listitem").first()).toContainText(`Arrangement: ${status}`);
  }
  await expect(page.getByRole("status")).toContainText("Status updated");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await testInfo.attach(`status-tech-support-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  }
  await session(page, "Coordinator");
  await page.reload();
  await expect(page.getByRole("region", { name: "Status history" })).toContainText("Demo Tech Support");
  await expect(page.getByRole("region", { name: "Status history" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("form", { name: "Update request status" })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh request" }).click();
  await expect(page.getByRole("region", { name: "Request details" })).toContainText("Arrangement: Requested");
  await testInfo.attach("status-coordinator-mobile.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("stale edit preserves input and requires reload before another write", async ({ page }) => {
  await session(page);
  let saved = { ...initial };
  let writes = 0;
  await page.route(API + PATH, route => route.fulfill({ json: { request: saved } }));
  await page.route(API + PATH + "/history?*", route => route.fulfill({ json: { history: [], has_more: false } }));
  await page.route(API + PATH + "/status", async route => {
    writes++;
    saved = { ...saved, status: "Unavailable", revision: 2 };
    await route.fulfill({ status: 409, json: { error: "Someone else updated this request. Reload it before saving." } });
  });
  await page.goto(PATH);
  await page.getByLabel("New status").selectOption("Reserved");
  await page.getByLabel("Update notes (optional)").fill("Do not lose my notes");
  await page.getByRole("button", { name: "Save status" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("Update notes (optional)")).toHaveValue("Do not lose my notes");
  await expect(page.getByRole("button", { name: "Save status" })).toBeDisabled();
  await page.getByRole("button", { name: "Reload latest request" }).click();
  await expect(page.getByLabel("New status")).toHaveValue("Unavailable");
  expect(writes).toBe(1);
});

test("history failure can be retried and history pages show older updates", async ({ page }) => {
  await session(page, "Coordinator");
  await page.route(API + PATH, route => route.fulfill({ json: { request: initial } }));
  let fail = true;
  await page.route(API + PATH + "/history?*", route => {
    if (fail) return route.fulfill({ status: 503, json: { error: "Could not load status history." } });
    const second = new URL(route.request().url()).searchParams.get("page") === "2";
    return route.fulfill({ json: { history: [{ ...entry, notes: second ? "Older update" : "Latest update" }], has_more: !second } });
  });
  await page.goto(PATH);
  await expect(page.getByRole("region", { name: "Status history" }).getByRole("alert")).toContainText("Could not load status history");
  fail = false;
  await page.getByRole("button", { name: "Retry history" }).click();
  await expect(page.getByRole("region", { name: "Status history" })).toContainText("Latest update");
  await page.getByRole("button", { name: "Older updates" }).click();
  await expect(page.getByRole("region", { name: "Status history" })).toContainText("Older update");
  await expect(page.getByRole("button", { name: "Older updates" })).toBeDisabled();
  await page.getByRole("button", { name: "Previous updates" }).click();
  await expect(page.getByRole("region", { name: "Status history" })).toContainText("Latest update");
});

test("closed event request remains readable without editing", async ({ page }) => {
  await session(page);
  await page.route(API + PATH, route => route.fulfill({ json: { request: { ...initial, event: { ...initial.event, status: "Cancelled" } } } }));
  await page.route(API + PATH + "/history?*", route => route.fulfill({ json: { history: [], has_more: false } }));
  await page.goto(PATH);
  await expect(page.getByText("This event is closed. Its equipment request and history are read-only.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save status" })).toHaveCount(0);
});

for (const role of ["Organiser", "Venue Staff", "Attendee", "Safety Officer", null]) {
  test(`request details deny ${role ?? "signed out"} before fetching`, async ({ page }) => {
    await session(page, role);
    let reads = 0;
    await page.route(API + "/equipment/requests/**", route => { reads++; return route.abort(); });
    await page.goto(PATH);
    await expect(page.getByRole("status")).toContainText(role ? "available to Tech Support and Coordinators" : "Sign in or select a demo user");
    expect(reads).toBe(0);
  });
}

test("an unrelated Coordinator gets no details or history", async ({ page }) => {
  await session(page, "Coordinator");
  await page.route(API + PATH, route => route.fulfill({ status: 404, json: { error: "Equipment request not found." } }));
  let historyReads = 0;
  await page.route(API + PATH + "/history?*", route => { historyReads++; return route.abort(); });
  await page.goto(PATH);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Equipment request not found.");
  await expect(page.getByRole("region", { name: "Request details" })).toHaveCount(0);
  expect(historyReads).toBe(0);
});
