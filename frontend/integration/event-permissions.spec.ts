import { expect, test } from "@playwright/test";

// Optional addresses let this new journey run on a second disposable stack locally.
// CI uses the standard integrated stack. No HTTP responses are mocked.
const WEB = process.env.QA_PERMISSION_WEB_URL ?? process.env.QA_WEB_URL ?? "http://localhost:3107";
const API = process.env.QA_PERMISSION_API_URL ?? process.env.QA_API_URL ?? "http://localhost:5001";
const PASSWORD = "disposable-test-only-password";

test("INTEGRATED-05 non-management roles cannot open unrelated event details or mutate lifecycle", async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: WEB });
  try {
    const login = await owner.request.post(`${API}/auth/login`, { headers: { Origin: WEB }, data: {
      email: "organiser.a@connectsphere.test", password: PASSWORD,
    } });
    expect(login.status()).toBe(200);
    const created = await owner.request.post(`${API}/events`, { headers: { Origin: WEB }, data: {
      action: "submit", title: `Permission boundary ${Date.now()}`, description: "Public description",
      purpose: "CONFIDENTIAL-161-PLANNING", category: "Workshop",
      event_datetime: "2099-10-20T06:00:00Z", expected_attendance: 2,
    } });
    expect(created.status()).toBe(201);
    const { event } = await created.json();
    const before = await owner.request.get(`${API}/events/${event.id}`, { headers: { Origin: WEB } });
    const original = await before.json();

    for (const [account, role] of [["attendee.a", "Attendee"], ["venue-staff", "Venue Staff"], ["tech-support", "Tech Support"]]) {
      const context = await browser.newContext({ baseURL: WEB });
      try {
        const page = await context.newPage();
        await page.goto(`${WEB}/login`);
        await page.getByLabel("Email", { exact: true }).fill(`${account}@connectsphere.test`);
        await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect(page).toHaveURL(`${WEB}/`);
        const session = await context.request.get(`${API}/session`, { headers: { Origin: WEB } });
        expect((await session.json()).user.role).toBe(role);

        const read = page.waitForResponse(r => r.url() === `${API}/events/${event.id}`);
        await page.goto(`${WEB}/events/${event.id}`);
        const deniedRead = await read;
        expect(deniedRead.status()).toBe(403);
        expect(await deniedRead.text()).not.toContain(event.purpose);
        await expect(page.getByText("You do not have access to this event.", { exact: true })).toBeVisible();
        await expect(page.getByText(event.purpose, { exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /^(Approve|Reject|Confirm event|Complete event|Cancel event)$/ })).toHaveCount(0);

        for (const status of ["Planning", "Confirmed", "Cancelled", "Completed"]) {
          const denied = await context.request.patch(`${API}/events/${event.id}/status`, {
            headers: { Origin: WEB }, data: { status },
          });
          expect(denied.status(), `${role} → ${status}`).toBe(403);
          const body = await denied.json();
          expect(body).not.toHaveProperty("event");
          expect(JSON.stringify(body)).not.toContain(event.purpose);
        }
        // Real persisted owner read, not a mocked response, proves attempts had no effect.
        const after = await owner.request.get(`${API}/events/${event.id}`, { headers: { Origin: WEB } });
        expect(await after.json()).toEqual(original);
      } finally {
        await context.close();
      }
    }
  } finally {
    await owner.close();
  }
});
