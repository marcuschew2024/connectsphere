import { test, expect } from "@playwright/test";

test("home page shows the ConnectSphere heading", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "ConnectSphere", level: 1 }),
  ).toBeVisible();
});

test("production build has no passwordless role switcher", async ({ page }) => {
  const devRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/dev/")) {
      devRequests.push(request.url());
    }
  });
  await page.goto("/");
  await expect(page.getByText(/API: (ok|unreachable)/)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Act as" })).toHaveCount(0);
  expect(devRequests).toEqual([]);
});

test("Venue Staff workspace includes booking request quick action", async ({ page }) => {
  await page.route("http://localhost:5001/session", (route) => route.fulfill({
    json: { user: { id: 3, display_name: "Demo Venue Staff", role: "Venue Staff" } },
  }));
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Add a venue" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Venue catalogue" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Venue booking requests" })).toHaveAttribute(
    "href",
    "/venues/bookings",
  );
});
