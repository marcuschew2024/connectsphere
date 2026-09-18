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
