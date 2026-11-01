import { expect, test } from "../../e2e/fixtures";

test("coverage retains executed source across two full page reloads", async ({ page }) => {
  await page.route("**/session", route => route.fulfill({ json: { user: null } }));
  await page.goto("/login");
  await expect(page.locator("form")).toBeVisible();
  const first = await page.evaluate(() => (window as unknown as { __coverageDocumentId: string }).__coverageDocumentId);
  await page.reload();
  await expect(page.locator("form")).toBeVisible();
  const second = await page.evaluate(() => (window as unknown as { __coverageDocumentId: string }).__coverageDocumentId);
  expect(second).not.toBe(first);
  await page.reload();
  await expect(page.locator("form")).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("__connectsphere_source_coverage__") ?? "{}"));
  expect(Object.keys(saved).sort()).toEqual([first, second].sort());
  for (const document of [first, second]) {
    const login = Object.keys(saved[document]).find(file => file.endsWith("/src/app/login/page.tsx"));
    expect(login).toBeTruthy();
    expect(Object.values(saved[document][login!].s).some(count => Number(count) > 0)).toBe(true);
  }
});
