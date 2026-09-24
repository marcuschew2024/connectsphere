import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "Asia/Singapore" });
const ID = "11111111-1111-4111-8111-111111111111";
const draft = {
  id: ID, title: "An evening of ideas", description: "Bring our campus community together.",
  purpose: "Share ideas", category: "Workshop", event_datetime: "2099-10-20T06:00:00Z",
  expected_attendance: 50, venue_requirements: "A quiet room", accessibility_requirements: "Step-free access",
  equipment_requirements: "Projector", registration_requirements: "RSVP",
  status: "Planning", request_status: "Draft", organiser_id: 1, coordinator_id: null,
  created_at: "2026-09-20T04:00:00Z", updated_at: "2026-09-20T05:00:00Z", submitted_at: null,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: 1, role: "Organiser", display_name: "Demo Organiser" },
  } }));
});

async function serveDraft(page: Page) {
  await page.route(`**/events/${ID}`, (route) => route.fulfill({ json: { event: draft } }));
}

test("home opens a private draft list with untitled fallback", async ({ page }) => {
  await page.route("**/events?status=Draft", (route) => route.fulfill({ json: {
    events: [draft, { ...draft, id: "22222222-2222-4222-8222-222222222222", title: null, description: null }],
  } }));
  await page.goto("/");
  await page.getByRole("link", { name: "My drafts" }).click();
  await expect(page.getByRole("heading", { name: "Room for your next idea." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Untitled request" })).toBeVisible();
  await expect(page.getByText("Only visible to you", { exact: false })).toBeVisible();
  await serveDraft(page);
  await page.getByRole("link", { name: "Continue editing An evening of ideas" }).click();
  await expect(page.getByLabel("Event name")).toHaveValue(draft.title);
});

test("empty list gives a clear starting point", async ({ page }) => {
  await page.route("**/events?status=Draft", (route) => route.fulfill({ json: { events: [] } }));
  await page.goto("/events/drafts");
  await expect(page.getByRole("heading", { name: "Every event starts with an idea." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create your first request" })).toHaveAttribute("href", "/events/new");
});

test("load failure offers a working retry", async ({ page }) => {
  let attempts = 0;
  await page.route("**/events?status=Draft", (route) => {
    attempts++;
    return route.fulfill(attempts === 1
      ? { status: 503, json: { error: "Could not load event requests." } }
      : { json: { events: [draft] } });
  });
  await page.goto("/events/drafts");
  await expect(page.locator("main").getByRole("alert")).toHaveText("Could not load event requests.");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: draft.title })).toBeVisible();
});

test("reopen, edit, save twice and reload the same draft", async ({ page }) => {
  let record = { ...draft };
  let saves = 0;
  await page.route(`**/events/${ID}`, async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      expect(body.action).toBe("draft");
      expect(body).not.toHaveProperty("organiser_id");
      expect(body).not.toHaveProperty("status");
      expect(body.event_datetime).toBe("2099-10-20T06:00:00.000Z");
      record = { ...record, ...body, status: "Draft", updated_at: "2026-09-20T06:00:00Z" };
      saves++;
    }
    await route.fulfill({ json: { event: record } });
  });
  await page.goto(`/events/drafts/${ID}`);
  await expect(page.getByLabel("Preferred date and time")).toHaveValue("2099-10-20T14:00");
  await expect(page.getByLabel("Venue requirements")).toHaveValue("A quiet room");
  await expect(page.getByLabel("Accessibility requirements")).toHaveValue("Step-free access");
  await expect(page.getByLabel("Equipment requirements")).toHaveValue("Projector");
  await expect(page.getByLabel("Registration requirements")).toHaveValue("RSVP");
  await page.getByLabel("Event name").fill("Updated idea");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await page.getByLabel("Event name").fill("Updated idea, again");
  await expect(page.locator("form").getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => saves).toBe(2);
  await page.reload();
  await expect(page.getByLabel("Event name")).toHaveValue("Updated idea, again");
});

test("completed draft submits with its existing reference", async ({ page }) => {
  await page.route(`**/events/${ID}`, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { event: draft } });
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().postDataJSON().action).toBe("submit");
    return route.fulfill({ json: {
      event: { ...draft, status: "Planning", request_status: "Submitted", submitted_at: "2026-09-20T06:00:00Z" },
      confirmation_email: "sent",
    } });
  });
  await page.goto(`/events/drafts/${ID}`);
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("heading", { name: "Event request received" })).toBeVisible();
  await expect(page.getByText(ID)).toBeVisible();
  await expect(page.getByRole("link", { name: "View event status" })).toHaveAttribute("href", `/events/${ID}`);
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.getByText("A confirmation email with your reference has been sent.")).toBeVisible();
  await expect(page.getByText(/Direct editing is now locked/)).toBeVisible();
});

test("email failure keeps the submitted reference and prevents another submission", async ({ page }) => {
  await page.route(`**/events/${ID}`, (route) => route.fulfill({ json:
    route.request().method() === "GET" ? { event: draft } : {
      event: { ...draft, status: "Planning", request_status: "Submitted" },
      confirmation_email: "unavailable",
    },
  }));
  await page.goto(`/events/drafts/${ID}`);
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText(ID)).toBeVisible();
  await expect(page.getByText(/we could not send the confirmation email/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit request" })).toHaveCount(0);
});

test("submission validation preserves entered details", async ({ page }) => {
  await page.route(`**/events/${ID}`, (route) => route.fulfill(route.request().method() === "GET"
    ? { json: { event: { ...draft, purpose: null } } }
    : { status: 400, json: { error: "Please check the highlighted fields.", fields: { purpose: "This field is required to submit." } } }));
  await page.goto(`/events/drafts/${ID}`);
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByLabel("Purpose")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Event name")).toHaveValue(draft.title);
  await expect(page.getByText("This field is required to submit.")).toBeVisible();
});

test("already submitted request is read only in the draft editor", async ({ page }) => {
  await page.route(`**/events/${ID}`, (route) => route.fulfill({ json: { event: { ...draft, request_status: "Submitted" } } }));
  await page.goto(`/events/drafts/${ID}`);
  await expect(page.getByRole("heading", { name: "This request has moved on." })).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
});

for (const role of ["Coordinator", "Venue Staff", "Tech Support", "Attendee", null]) {
  test(`draft screens do not load private records for ${role ?? "no user"}`, async ({ page }) => {
    let reads = 0;
    await page.route("**/session", (route) => route.fulfill({ json: { user: role ? { id: 2, role } : null } }));
    await page.route("**/events**", (route) => {
      if (new URL(route.request().url()).port === "5001") reads++;
      return route.continue();
    });
    for (const path of ["/events/drafts", `/events/drafts/${ID}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "A private space for Organisers" })).toBeVisible();
      await expect(page.locator("form")).toHaveCount(0);
    }
    expect(reads).toBe(0);
  });
}

test("another organiser's direct draft URL shows no private details", async ({ page }) => {
  await page.route(`**/events/${ID}`, (route) => route.fulfill({ status: 404, json: { error: "Event not found." } }));
  await page.goto(`/events/drafts/${ID}`);
  await expect(page.locator("main").getByRole("alert")).toHaveText("Event not found.");
  await expect(page.locator("form")).toHaveCount(0);
});

for (const status of [409, 503]) {
  test(`save error ${status} preserves the edited form`, async ({ page }) => {
    await page.route(`**/events/${ID}`, (route) => route.fulfill(route.request().method() === "GET"
      ? { json: { event: draft } }
      : { status, json: { error: "Reload this draft before retrying." } }));
    await page.goto(`/events/drafts/${ID}`);
    await page.getByLabel("Event name").fill("Keep my edits");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText("Reload this draft before retrying.");
    await expect(page.getByLabel("Event name")).toHaveValue("Keep my edits");
  });
}

test("draft list and editor fit a mobile screen and respect reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/events?status=Draft", (route) => route.fulfill({ json: { events: [draft] } }));
  await page.goto("/events/drafts");
  await expect(page.getByRole("heading", { name: draft.title })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator(".draft-reveal").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await serveDraft(page);
  await page.getByRole("link", { name: `Continue editing ${draft.title}` }).click();
  await expect(page.getByLabel("Event name")).toHaveValue(draft.title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
