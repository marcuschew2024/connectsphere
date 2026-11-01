import { expect, test, type Page } from "@playwright/test";

const API = process.env.QA_API_URL ?? "http://localhost:5001";
const ORIGIN = process.env.QA_WEB_URL ?? "http://localhost:3107";

async function signIn(page: Page, account: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(`${account}@connectsphere.test`);
  await page.getByLabel("Password", { exact: true }).fill("disposable-test-only-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${ORIGIN}/`);
}

test("INTEGRATED-04 readable references survive reload and retain UUID routes", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: ORIGIN });
  try {
    const page = await context.newPage();
    await signIn(page, "organiser.a");
    const response = await context.request.post(`${API}/events`, {
      headers: { Origin: ORIGIN }, data: {
        action: "submit", title: "Campus Welcome Workshop", description: "Meet fellow students",
        purpose: "Welcome students", category: "Workshop",
        event_datetime: "2099-11-01T08:00:00Z", expected_attendance: 10,
      },
    });
    expect(response.status()).toBe(201);
    const { event } = await response.json();
    expect(event.reference).toMatch(/^EVT-\d{3,}$/);
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    const label = `${event.reference} · 01 Nov 2099`;
    await page.goto("/events/mine");
    const card = page.getByRole("listitem").filter({ hasText: label });
    await expect(card).toHaveCount(1);
    await card.getByRole("link", { name: "Campus Welcome Workshop", exact: true }).click();
    await expect(page).toHaveURL(`${ORIGIN}/events/${event.id}`);
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    const denied = await context.request.post(`${API}/events`, {
      headers: { Origin: ORIGIN }, data: { action: "draft", title: "Injected reference", reference: "EVT-999999" },
    });
    expect(denied.status()).toBe(400);

  } finally {
    await context.close();
  }
});
