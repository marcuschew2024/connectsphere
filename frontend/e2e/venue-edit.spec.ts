import { expect, test } from "@playwright/test";

const API = "http://localhost:5001";
const ID = "11111111-1111-4111-8111-111111111111";
const path = `/venues/${ID}/edit`;
const initial = {
  id: ID, name: "Seminar Room A", location: "Building B", capacity: 100,
  facilities: ["Projector", "Wi-Fi"], accessibility: ["Lift"],
  supported_layouts: ["Classroom", "Custom layout"],
  operating_hours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, {opens: "09:00", closes: "18:00"}])),
  timezone: "Asia/Singapore", created_by: 3, created_at: "2026-09-24T06:00:00Z", revision: 1,
};

test.beforeEach(async ({ page }) => {
  await page.route(API + "/session", route => route.fulfill({json: {user: {id: 3, role: "Venue Staff"}}}));
  await page.route(API + "/venues/filter-options", route => route.fulfill({json: {facilities: [], accessibility: []}}));
});

test("staff opens a prefilled form, saves all five fields, and sees updated catalogue", async ({page}, testInfo) => {
  let venue = {...initial};
  await page.route(API + "/venues?*", route => route.fulfill({json: {venues: [venue], page: 1, has_more: false}}));
  await page.route(API + `/venues/${ID}`, route => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      expect(Object.keys(body).sort()).toEqual(["accessibility", "capacity", "facilities", "operating_hours", "revision", "supported_layouts"]);
      expect(body.revision).toBe(1);
      expect(body.capacity).toBe(80);
      expect(body.facilities).toEqual(["Whiteboard"]);
      expect(body.accessibility).toEqual(["Ramp"]);
      expect(body.supported_layouts).toEqual(["Custom layout"]);
      expect(body.operating_hours.monday).toEqual({opens: "10:00", closes: "18:00"});
      venue = {...venue, ...body, revision: 2};
    }
    return route.fulfill({json: {venue}});
  });
  await page.goto("/venues");
  await page.getByRole("link", {name: "Edit venue", exact: true}).click();
  await expect(page.getByLabel("Venue name")).toHaveValue(initial.name);
  await expect(page.getByLabel("Venue name")).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Facilities", {exact: true})).toHaveValue("Projector, Wi-Fi");
  await expect(page.getByRole("checkbox", {name: "Custom layout", exact: true})).toBeChecked();
  await page.getByLabel("Capacity").fill("80");
  await page.getByLabel("Facilities", {exact: true}).fill("Whiteboard");
  await page.getByLabel("Accessibility features").fill("Ramp");
  await page.getByRole("checkbox", {name: "Classroom", exact: true}).uncheck();
  await page.getByLabel("monday opens").fill("10:00");
  await page.screenshot({path: testInfo.outputPath("edit-desktop.png"), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: testInfo.outputPath("edit-mobile.png"), fullPage: true});
  await page.getByRole("button", {name: "Save changes"}).click();
  await expect(page.getByRole("heading", {name: "Venue updated"})).toBeVisible();
  await expect(page.getByText(/Confirmed bookings are unchanged/)).toBeVisible();
  await page.getByRole("link", {name: "View catalogue"}).click();
  await expect(page.getByText("80 people")).toBeVisible();
  await page.reload();
  await expect(page.getByText("80 people")).toBeVisible();
});

for (const role of ["Coordinator", "Organiser", "Tech Support", "Attendee", null]) {
  test(`editing denied for ${role ?? "no session"}`, async ({page}) => {
    let requests = 0;
    await page.route(API + "/session", route => route.fulfill({json: {user: role ? {id: 2, role} : null}}));
    await page.route(API + `/venues/${ID}`, route => { requests++; return route.fulfill({json: {venue: initial}}); });
    await page.goto(path);
    await expect(page.getByText(role ? "Only Venue Staff can edit a venue." : "Sign in or select a demo user to continue.")).toBeVisible();
    await expect(page.getByRole("button", {name: "Save changes"})).toHaveCount(0);
    expect(requests).toBe(0);
  });
}

for (const status of [400, 409, 503]) {
  test(`failed save (${status}) retains edits and reports the problem`, async ({page}) => {
    await page.route(API + `/venues/${ID}`, route => route.request().method() === "PUT"
      ? route.fulfill({status, json: {error: status === 409 ? "Another staff member updated this venue. Reload it and reapply your changes." : "Please check the highlighted fields.", fields: status === 400 ? {capacity: "Enter a positive whole number."} : {}}})
      : route.fulfill({json: {venue: initial}}));
    await page.goto(path);
    await page.getByLabel("Capacity").fill("0");
    await page.getByRole("button", {name: "Save changes"}).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Capacity")).toHaveValue("0");
    await expect(page.getByRole("heading", {name: "Venue updated"})).toHaveCount(0);
    if (status === 400) await expect(page.getByLabel("Capacity")).toHaveAttribute("aria-invalid", "true");
  });
}

test("cancel does not save", async ({page}) => {
  let writes = 0;
  await page.route(API + `/venues/${ID}`, route => { if (route.request().method() === "PUT") writes++; return route.fulfill({json: {venue: initial}}); });
  await page.route(API + "/venues?*", route => route.fulfill({json: {venues: [initial], page: 1, has_more: false}}));
  await page.goto(path);
  await page.getByLabel("Capacity").fill("55");
  await page.getByRole("link", {name: "Cancel", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Venue catalogue"})).toBeVisible();
  expect(writes).toBe(0);
});

test("missing venue reports a useful error", async ({page}) => {
  await page.route(API + `/venues/${ID}`, route => route.fulfill({status: 404, json: {error: "Venue not found."}}));
  await page.goto(path);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Venue not found.");
  await expect(page.getByRole("button", {name: "Save changes"})).toHaveCount(0);
});
