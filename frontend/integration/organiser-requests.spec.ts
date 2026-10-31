import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:5001";
const ORIGIN = "http://localhost:3107";

async function signIn(page: Page, account: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(`${account}@connectsphere.test`);
  await page.getByLabel("Password", { exact: true }).fill("disposable-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${ORIGIN}/`);
}

test("INTEGRATED-03 Organiser rediscovers an unassigned submission after signing back in; other accounts cannot see it", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: ORIGIN });
  const otherContext = await browser.newContext({ baseURL: ORIGIN });
  try {
    const page = await context.newPage();
    const other = await otherContext.newPage();
    await signIn(page, "organiser.a");
    await signIn(other, "organiser.b");
    const title = `My submitted workshop ${randomUUID()}`;
    const otherTitle = `Another organiser's workshop ${randomUUID()}`;
    const setup = await otherContext.request.post(`${API}/events`, {
      headers: { Origin: ORIGIN }, data: {
        action: "submit", title: otherTitle, description: "Other workshop", purpose: "Private",
        category: "Workshop", event_datetime: "2099-10-20T06:00:00Z", expected_attendance: 10,
      },
    });
    expect(setup.status()).toBe(201);
    const foreignId = (await setup.json()).event.id;

    await page.goto("/events/new");
    await page.getByLabel("Event name").fill(title);
    await page.getByLabel("Description").fill("A campus workshop");
    await page.getByLabel("Purpose").fill("Learning together");
    await page.getByLabel("Category").fill("Workshop");
    await page.getByLabel("Preferred date and time").fill("2099-10-20T14:00");
    await page.getByLabel("Expected attendance").fill("10");
    const submitted = page.waitForResponse((r) => r.url() === `${API}/events` && r.request().method() === "POST");
    await page.getByRole("button", { name: "Submit request", exact: true }).click();
    const response = await submitted;
    expect(response.status()).toBe(201);
    const event = (await response.json()).event;
    expect(event.coordinator_id).toBeNull();
    await expect(page.getByRole("heading", { name: "Event request received" })).toBeVisible();
    await page.getByRole("link", { name: "View my requests", exact: true }).click();
    const card = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: title, exact: true }) });
    await expect(card.getByText("Waiting for Coordinator assignment", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(`${ORIGIN}/login`);
    await signIn(page, "organiser.a");
    await page.getByRole("link", { name: "My submitted requests", exact: true }).click();
    await expect(page.getByRole("link", { name: otherTitle, exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: title, exact: true }).click();
    await expect(page).toHaveURL(`${ORIGIN}/events/${event.id}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const denied = await context.request.get(`${API}/events/${foreignId}`, { headers: { Origin: ORIGIN } });
    expect(denied.status()).toBe(403);
    await other.goto("/events/mine");
    await expect(other.getByRole("link", { name: otherTitle, exact: true })).toBeVisible();
    await expect(other.getByRole("link", { name: title, exact: true })).toHaveCount(0);
  } finally {
    await context.close();
    await otherContext.close();
  }
});
