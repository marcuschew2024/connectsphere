import { expect, test } from "@playwright/test";

const ID = "11111111-1111-4111-8111-111111111111";
const API_ORIGIN = "http://localhost:5001";
const REASON = "The requested venue is unavailable. Please choose another date.";
const notification = {
  id: 1, event_id: ID, notification_type: "event_rejected",
  message: `Your event request was rejected: ${REASON}`,
  created_at: "2026-09-24T04:00:00Z",
};
const rejectedEvent = {
  id: ID, title: "Campus workshop", description: "Learn together.", category: "Workshop",
  status: "Rejected", request_status: "Rejected", organiser_id: 1, coordinator_id: 2,
  event_datetime: "2099-10-20T06:00:00Z", updated_at: notification.created_at,
  last_status_changed_at: notification.created_at, last_status_changed_by: 2,
  decision_reason: REASON, decision_at: notification.created_at, decision_by: 2,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: 1, role: "Organiser", display_name: "Demo Organiser" },
  } }));
});

for (const decision of ["approve", "reject"] as const) {
  test(`${decision} reaches the Organiser's notifications and request page`, async ({ page }) => {
    let role = "Coordinator";
    let decided = false;
    const accepted = decision === "approve";
    const result = {...rejectedEvent, status: accepted ? "Planning" : "Rejected", request_status: accepted ? "Planning" : "Rejected", decision_reason: accepted ? null : REASON};
    const message = accepted ? {...notification, notification_type: "event_approved", message: "Your event request was accepted by the Coordinator and is now in Planning.", event: {title: result.title}} : notification;
    await page.route("**/session", (route) => route.fulfill({ json: {user: {id: role === "Coordinator" ? 2 : 1, role}} }));
    await page.route("**/notifications", (route) => route.fulfill({json: {notifications: decided ? [message] : []}}));
    await page.route(`${API_ORIGIN}/events/${ID}`, (route) => route.fulfill({json: {
      event: decided ? result : {...rejectedEvent, status: "Submitted", request_status: "Submitted", decision_reason: null, decision_at: null, decision_by: null},
    }}));
    await page.route(`${API_ORIGIN}/events/${ID}/history`, (route) => route.fulfill({json: {history: []}}));
    await page.route(`${API_ORIGIN}/events/${ID}/clarification`, (route) => route.fulfill({json: {clarification: null}}));
    await page.route(`${API_ORIGIN}/events/${ID}/decision`, (route) => {
      expect(route.request().postDataJSON()).toEqual(accepted ? {decision: "approve"} : {decision: "reject", reason: REASON});
      decided = true;
      return route.fulfill({json: {event: result}});
    });
    await page.goto(`/events/${ID}`);
    await expect(page.getByRole("button", {name: "Approve", exact:true})).toBeInViewport();
    await expect(page.getByRole("link", {name: "Back to review queue"})).toBeVisible();
    if (!accepted) await page.getByLabel("Rejection reason", {exact:true}).fill(REASON);
    await page.getByRole("button", {name: accepted ? "Approve" : "Reject", exact:true}).click();
    const outcome = accepted ? "Request accepted" : "Rejection reason";
    await expect(page.getByRole("region", {name: outcome})).toBeVisible();
    if (accepted) {
      await expect(page.getByRole("heading", {name: "Edit event details"})).toBeHidden();
      await page.locator("summary").filter({hasText:"Edit event details"}).click();
      await expect(page.getByRole("heading", {name:"Edit event details"})).toBeVisible();
    }
    role = "Organiser";
    await page.goto("/");
    const inbox = page.getByRole("region", {name:"Notifications"});
    await expect(inbox.getByRole("heading", {name:accepted ? "Request accepted" : "Request rejected"})).toBeVisible();
    await expect(inbox).toContainText(message.message);
    await inbox.getByRole("link", {name:"View request"}).click();
    await expect(page).toHaveURL(new RegExp(`/events/${ID}$`));
    await expect(page.getByText(result.status, {exact:true})).toBeVisible();
    await expect(page.getByRole("region", {name:outcome})).toBeVisible();
    if (!accepted) await expect(page.getByRole("region", {name:outcome})).toContainText(REASON);
    await expect(page.getByRole("button", {name:"Reject", exact:true})).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", {name:outcome})).toBeVisible();
  });
}

test("notifications show an empty state", async ({ page }) => {
  await page.route("**/notifications", (route) => route.fulfill({ json: { notifications: [] } }));
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("No notifications yet.");
});

test("failed notifications can be refreshed", async ({ page }) => {
  let attempts = 0;
  await page.route("**/notifications", (route) => {
    attempts++;
    return route.fulfill(attempts === 1
      ? { status: 503, json: { error: "Could not load notifications. Please try again." } }
      : { json: { notifications: [notification] } });
  });
  await page.goto("/");
  const inbox = page.getByRole("region", { name: "Notifications" });
  await expect(inbox.getByRole("alert")).toContainText("Could not load notifications.");
  await expect(inbox.getByText("No notifications yet.")).toHaveCount(0);
  await inbox.getByRole("button", { name: "Refresh" }).click();
  await expect(inbox).toContainText(REASON);
  await expect(inbox.getByRole("alert")).toHaveCount(0);
});

for (const role of ["Coordinator", "Venue Staff", "Tech Support", "Attendee", null]) {
  test(`notifications are not loaded for ${role ?? "no user"}`, async ({ page }) => {
    let reads = 0;
    await page.route("**/session", (route) => route.fulfill({ json: {
      user: role ? { id: 2, role } : null,
    } }));
    await page.route("**/notifications", (route) => {
      reads++;
      return route.fulfill({ json: { notifications: [notification] } });
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: role ? `You’re in ${role} view` : "Your workspace" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Notifications" })).toHaveCount(0);
    expect(reads).toBe(0);
  });
}

test("older rejected requests explain when no reason was recorded", async ({ page }) => {
  await page.route(`${API_ORIGIN}/events/${ID}`, (route) => route.fulfill({ json: {
    event: { ...rejectedEvent, decision_reason: null, decision_at: null },
  } }));
  await page.route(`${API_ORIGIN}/events/${ID}/history`, (route) => route.fulfill({ json: { history: [] } }));
  await page.route(`${API_ORIGIN}/events/${ID}/clarification`, (route) => route.fulfill({ json: { clarification: null } }));
  await page.goto(`/events/${ID}`);
  await expect(page.getByRole("region", { name: "Rejection reason" })).toContainText("No rejection reason was recorded.");
});

for (const width of [1440, 375]) {
  test(`notification pages stay compact at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height:900});
    await page.route("**/notifications", (route) => route.fulfill({json:{notifications: Array.from({length:9}, (_, i) => ({...notification, id:i+1, message:`Decision ${i+1}: ${REASON}`, event:{title:"Campus workshop " + (i+1)}}))}}));
    await page.goto("/");
    const inbox = page.getByRole("region", {name:"Notifications"});
    await expect(inbox.getByRole("listitem")).toHaveCount(4);
    await expect(inbox).toContainText("Campus workshop 1");
    await expect(inbox.getByRole("button", {name:"Previous"})).toBeDisabled();
    await inbox.getByRole("button", {name:"Next", exact:true}).click();
    await expect(inbox).toContainText("Campus workshop 5");
    await expect(inbox).not.toContainText("Campus workshop 1");
    await inbox.getByRole("button", {name:"Next", exact:true}).click();
    await expect(inbox.getByRole("listitem")).toHaveCount(1);
    await expect(inbox.getByRole("button", {name:"Next", exact:true})).toBeDisabled();
    await inbox.getByRole("button", {name:"Previous"}).click();
    await expect(inbox).toContainText("Campus workshop 5");
    await inbox.getByRole("button", {name:"Refresh"}).click();
    await expect(inbox).toContainText("Campus workshop 1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("Planning alone does not mean the request was accepted", async ({page}) => {
  await page.setViewportSize({width:375, height:812});
  await page.route(`${API_ORIGIN}/events/${ID}`, (route) => route.fulfill({json:{event:{...rejectedEvent, status:"Planning", request_status:"Submitted", decision_at:null, decision_by:null, decision_reason:null}}}));
  await page.route(`${API_ORIGIN}/events/${ID}/history`, (route) => route.fulfill({json:{history:[{id:1, new_status:"Submitted", changed_by:1, changed_at:notification.created_at}]}}));
  await page.route(`${API_ORIGIN}/events/${ID}/clarification`, (route) => route.fulfill({json:{clarification:null}}));
  await page.goto(`/events/${ID}`);
  await expect(page.getByText("Your request is with the Coordinator.", {exact:false})).toBeVisible();
  await expect(page.getByRole("region", {name:"Request accepted"})).toHaveCount(0);
  await expect(page.getByText("Created → Submitted")).toBeHidden();
  await page.locator("summary").filter({hasText:"Status history"}).click();
  await expect(page.getByText("Created → Submitted")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
