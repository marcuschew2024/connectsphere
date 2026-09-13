import { test, expect } from "@playwright/test";

test("home page shows the ConnectSphere heading", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "ConnectSphere", level: 1 }),
  ).toBeVisible();
});
