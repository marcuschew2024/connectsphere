import { test, expect } from "./fixtures";

// SCRUM-139: real login is the entry point; demo identities never drive a production build.
const API = "http://localhost:5001";

test("a signed-out visitor to home is sent to the login page", async ({ page }) => {
  await page.route(`${API}/session`, (route) => route.fulfill({ json: { user: null } }));
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("an unreachable API keeps home on a sign-in prompt instead of redirecting", async ({ page }) => {
  await page.route(`${API}/session`, (route) => route.fulfill({
    status: 503, json: { error: "Database unavailable." },
  }));
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
  await expect(page).toHaveURL(/\/$/);
});

// SCRUM-141 (R12): a failed sign-out must not pretend success.
test("a failed sign-out surfaces an error and keeps the user on the page", async ({ page }) => {
  const user = { id: 42, display_name: "Coordinator Account A", role: "Coordinator" };
  await page.route(`${API}/session`, (route) => route.fulfill({ json: { user } }));
  await page.route(`${API}/notifications`, (route) => route.fulfill({ json: { notifications: [] } }));
  await page.route(`${API}/events`, (route) => route.fulfill({ json: { events: [] } }));
  await page.route(`${API}/auth/logout`, (route) =>
    route.fulfill({ status: 503, json: { error: "Database unavailable." } }));

  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page.getByText("Could not sign you out. Please try again.")).toBeVisible();
  await expect(page).toHaveURL(/\/$/); // stayed put — not redirected to /login
});

test("signing in lands on the account's own workspace with no demo lookups", async ({ page }) => {
  const devRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/dev/")) devRequests.push(request.url());
  });
  let signedIn = false;
  const user = { id: 42, display_name: "Coordinator Account A", role: "Coordinator" };
  await page.route(`${API}/session`, (route) => route.fulfill({ json: { user: signedIn ? user : null } }));
  await page.route(`${API}/auth/login`, (route) => {
    signedIn = true;
    return route.fulfill({ json: { user } });
  });
  await page.route(`${API}/notifications`, (route) => route.fulfill({ json: { notifications: [] } }));

  await page.goto("/login");
  await page.getByLabel("Email").fill("coordinator.a@connectsphere.test");
  await page.getByLabel("Password").fill("a-password-for-the-mock");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "You’re in Coordinator view" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Act as" })).toHaveCount(0);
  expect(devRequests).toEqual([]);
});
