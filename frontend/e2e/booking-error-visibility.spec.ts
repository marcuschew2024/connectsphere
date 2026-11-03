import { test, expect } from "./fixtures";

test.use({ timezoneId: "Asia/Singapore" });
for (const width of [390, 1280]) {
  for (const failure of ["validation", "maintenance"] as const) {
    test(`${width}px booking ${failure} error stays visible and focused after submit and retry`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.route("**/session", route => route.fulfill({ json: {
        user: { id: 2, display_name: "Coordinator", role: "Coordinator" },
      } }));
      await page.route("**/notifications", route => route.fulfill({ json: { notifications: [] } }));
      await page.route("**/events", route => route.fulfill({ json: { events: [{
        id: "event", title: "Workshop", status: "Planning", is_mine: true,
        event_datetime: "2099-10-20T06:00:00Z", expected_attendance: 20,
      }] } }));
      await page.route("**/venues?page=*", route => route.fulfill({ json: {
        venues: [{ id: "room", name: "Seminar room", capacity: 30, operating_hours: {} }], has_more: false,
      } }));
      await page.route("**/suitability/*", route => route.fulfill({ json: {
        suitability: { is_suitable: true, flags: [], checked_rules_count: 1 },
      } }));
      await page.route("**/venues/bookings", route => route.fulfill({ status: 409, json: {
        error: "The venue is unavailable during the event or its setup/turnaround time.",
      } }));
      await page.goto("/venues/bookings/new");
      await expect(page.getByRole("combobox", { name: "Venue", exact: true })).toHaveValue("room");
      await page.getByLabel("Start", { exact: true }).fill("2099-10-20T14:00");
      await page.getByLabel("End", { exact: true }).fill(failure === "validation" ? "2099-10-20T13:00" : "2099-10-20T15:00");
      await page.getByRole("checkbox", { name: "Classroom", exact: true }).check();
      const submit = page.getByRole("button", { name: "Submit booking request", exact: true });
      for (let attempt = 0; attempt < 2; attempt++) {
        await submit.click();
        const error = page.locator("form").getByRole("alert");
        await expect(error).toContainText(failure === "validation" ? "after the start" : "setup/turnaround");
        await expect(error).toBeInViewport();
        await expect(error).toBeFocused();
        await expect(submit).toBeInViewport();
        await expect(page.getByLabel("Start", { exact: true })).toHaveValue("2099-10-20T14:00");
      }
    });
  }
}
