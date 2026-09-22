import { test, expect, type Page } from "@playwright/test";

test.use({ timezoneId: "Asia/Singapore" });

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const API_ORIGIN = "http://localhost:5001";

test.beforeEach(async ({ page }) => {
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: 1, display_name: "Demo Organiser", role: "Organiser" },
  } }));
});

for (const role of ["Coordinator", "Venue Staff", "Tech Support", "Attendee", null]) {
  test(`form is hidden for ${role ?? "no selection"}, including a direct visit`, async ({ page }) => {
    await page.route("**/session", (route) => route.fulfill({ json: {
      user: role ? { id: 2, display_name: "Demo user", role } : null,
    } }));
    await page.goto("/");
    // SCRUM-21: non-Organisers get no create action at all (previously a disabled button).
    await expect(page.getByRole("link", { name: "Create an event request" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create an event request" })).toHaveCount(0);
    await expect(page.getByRole("heading", {
      name: role ? `You’re in ${role} view` : "Your workspace",
    })).toBeVisible();
    await page.goto("/events/new");
    await expect(page.locator("form")).toBeHidden();
    await expect(page.getByRole("button", { name: "Submit request" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save as draft" })).toHaveCount(0);
    await expect(page.getByRole("heading", {
      name: role ? `You’re in ${role} view` : "Choose a role to get started",
    })).toBeVisible();
  });
}

test("creation stays unavailable while the session loads or cannot be checked", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/session", async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { error: "Database unavailable." } });
  });
  await page.goto("/");
  // SCRUM-21: creation is simply absent (not a disabled button) until a session resolves to Organiser.
  await expect(page.getByRole("link", { name: "Create an event request" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create an event request" })).toHaveCount(0);
  const failed = page.waitForResponse((response) => response.url().endsWith("/session"));
  release();
  await failed;
  await expect(page.getByRole("link", { name: "Create an event request" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create an event request" })).toHaveCount(0);
});

async function fillRequiredFields(page: Page) {
  await page.getByLabel("Event name").fill("Campus workshop");
  await page.getByLabel("Description").fill("Learn together.");
  await page.getByLabel("Purpose").fill("Share skills");
  await page.getByLabel("Category").fill("Workshop");
  await page.getByLabel("Preferred date and time").fill("2099-10-20T14:00");
  await page.getByLabel("Expected attendance").fill("50");
}

test("home links to the event request form", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Create an event request" }).click();
  await expect(page.getByRole("heading", { name: "Create an event request" })).toBeVisible();
});

test("submission sends details and shows the saved reference", async ({ page }) => {
  await page.route("**/events", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.action).toBe("submit");
    expect(body.title).toBe("Campus workshop");
    expect(body.expected_attendance).toBe(50);
    expect(body.venue_requirements).toBe("Room for 50");
    expect(body.accessibility_requirements).toBe("Step-free access");
    expect(body.equipment_requirements).toBe("Projector");
    expect(body.registration_requirements).toBe("RSVP");
    expect(body).not.toHaveProperty("organiser_id");
    expect(body).not.toHaveProperty("status");
    expect(body.event_datetime).toBe("2099-10-20T06:00:00.000Z");
    await route.fulfill({ status: 201, json: { event: {
      ...body, id: EVENT_ID, status: "Submitted", created_at: "2026-09-20T04:00:00Z",
    } } });
  });
  await page.goto("/events/new");
  await fillRequiredFields(page);
  await page.getByLabel("Venue requirements").fill("Room for 50");
  await page.getByLabel("Accessibility requirements").fill("Step-free access");
  await page.getByLabel("Equipment requirements").fill("Projector");
  await page.getByLabel("Registration requirements").fill("RSVP");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("heading", { name: "Event request received" })).toBeVisible();
  await expect(page.getByText(EVENT_ID)).toBeVisible();
  await expect(page.getByText(/now under Planning/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit request" })).toHaveCount(0);
  await page.getByRole("button", { name: "Create another request" }).click();
  await expect(page.getByLabel("Event name")).toHaveValue("");
});

test("partial draft bypasses required submission fields", async ({ page }) => {
  await page.route("**/events", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.action).toBe("draft");
    expect(body.description).toBe("");
    expect(body.event_datetime).toBeNull();
    expect(body.expected_attendance).toBeNull();
    await route.fulfill({ status: 201, json: { event: {
      ...body, id: EVENT_ID, status: "Draft", created_at: "2026-09-20T04:00:00Z",
    } } });
  });
  await page.goto("/events/new");
  await page.getByLabel("Event name").fill("Idea for later");
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByRole("heading", { name: "Draft saved" })).toBeVisible();
  await expect(page.getByText(/not been submitted for review/)).toBeVisible();
});

test("server validation appears beside fields and preserves the form", async ({ page }) => {
  await page.route("**/events", (route) => route.fulfill({ status: 400, json: {
    error: "Please check the highlighted fields.",
    fields: { expected_attendance: "Enter a whole number greater than zero.", purpose: "This field is required to submit." },
  } }));
  await page.goto("/events/new");
  await page.getByLabel("Event name").fill("Keep this title");
  await page.getByLabel("Expected attendance").fill("0");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Please check the highlighted fields.");
  await expect(page.getByLabel("Expected attendance")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter a whole number greater than zero.")).toBeVisible();
  await expect(page.getByLabel("Event name")).toHaveValue("Keep this title");
});

for (const [status, message] of [
  [401, "Select a demo user first."],
  [403, "Only Organisers can create event requests."],
  [503, "Could not confirm that the request was saved. Contact the team before retrying."],
] as const) {
  test(`API error ${status} keeps entered details and does not show success`, async ({ page }) => {
    await page.route("**/events", (route) => route.fulfill({ status, json: { error: message } }));
    await page.goto("/events/new");
    await fillRequiredFields(page);
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(message);
    await expect(page.getByLabel("Event name")).toHaveValue("Campus workshop");
    await expect(page.getByRole("heading", { name: "Event request received" })).toHaveCount(0);
  });
}

test("event page does not expose the switcher in production", async ({ page }) => {
  const devRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/dev/")) devRequests.push(request.url());
  });
  await page.goto("/events/new");
  // Interact after hydration before checking that no development API was called.
  await page.getByLabel("Event name").fill("Production check");
  await expect(page.getByRole("combobox", { name: "Act as" })).toHaveCount(0);
  expect(devRequests).toEqual([]);
});

const CLARIFICATION_EVENT = {
  id: EVENT_ID,
  title: "Campus workshop",
  description: "Learn together.",
  purpose: "Share skills",
  category: "Workshop",
  event_datetime: "2099-10-20T06:00:00.000Z",
  expected_attendance: 50,
  venue_requirements: "Room for 50",
  accessibility_requirements: "Step-free access",
  equipment_requirements: "Projector",
  registration_requirements: "RSVP",
  status: "Submitted",
  organiser_id: 1,
  coordinator_id: 2,
  coordinator_assigned_at: "2026-09-20T04:00:00Z",
  created_at: "2026-09-20T04:00:00Z",
  updated_at: "2026-09-20T04:00:00Z",
  submitted_at: "2026-09-20T04:00:00Z",
  last_status_changed_by: 1,
  last_status_changed_at: "2026-09-20T04:00:00Z",
  decision_reason: null,
  decision_by: null,
  decision_at: null,
};

test("coordinator can return a submitted request with a required note", async ({ page }) => {
  await page.unroute("**/session");
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: 2, display_name: "Demo Coordinator", role: "Coordinator" },
  } }));
  await page.route(`${API_ORIGIN}/events/11111111-1111-4111-8111-111111111111`, (route) =>
    route.fulfill({ json: { event: CLARIFICATION_EVENT } }));
  await page.route(`${API_ORIGIN}/events/11111111-1111-4111-8111-111111111111/history`, (route) =>
    route.fulfill({ json: { history: [] } }));
  await page.route(`${API_ORIGIN}/events/11111111-1111-4111-8111-111111111111/clarification`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { clarification: null } });
      return;
    }
    await route.fulfill({ status: 201, json: { clarification: {
      id: 1, event_id: EVENT_ID, note: "Please clarify the venue.", requested_by: 2,
      requested_at: "2026-09-21T04:00:00Z", status: "Pending", responded_by: null, responded_at: null,
    } } });
  });
  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByRole("heading", { name: "Request clarification" })).toBeVisible();
  await page.getByRole("button", { name: "Return for clarification" }).click();
  await expect(page.getByText("Explain what the organiser needs to clarify.", { exact: true })).toBeVisible();
  await page.getByLabel("Clarification note").fill("Please clarify the venue.");
  const clarificationResponse = page.waitForResponse((response) =>
    response.url() === `${API_ORIGIN}/events/${EVENT_ID}/clarification`
      && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Return for clarification" }).click();
  await clarificationResponse;
  await expect(page.getByTestId("clarification-confirmation")).toContainText("Please clarify the venue.");
  await expect(page.getByRole("heading", { name: "Review request" })).toHaveCount(0);
});

test("organiser can revise and resubmit a returned request", async ({ page }) => {
  await page.unroute("**/session");
  await page.route("**/session", (route) => route.fulfill({ json: {
    user: { id: 1, display_name: "Demo Organiser", role: "Organiser" },
  } }));
  await page.route(`${API_ORIGIN}/events/11111111-1111-4111-8111-111111111111`, (route) =>
    route.fulfill({ json: { event: CLARIFICATION_EVENT } }));
  await page.route(`${API_ORIGIN}/events/11111111-1111-4111-8111-111111111111/history`, (route) =>
    route.fulfill({ json: { history: [{
      id: 1, event_id: EVENT_ID, old_status: "Submitted", new_status: "Submitted",
      action: "clarification_requested", note: "Please clarify the venue.", changed_by: 2,
      changed_at: "2026-09-21T04:00:00Z",
    }] } }));
  await page.route(`${API_ORIGIN}/events/11111111-1111-4111-8111-111111111111/clarification`, (route) =>
    route.fulfill({ json: { clarification: {
      id: 1, event_id: EVENT_ID, note: "Please clarify the venue.", requested_by: 2,
      requested_at: "2026-09-21T04:00:00Z", status: "Pending", responded_by: null, responded_at: null,
    } } }));
  await page.route(`${API_ORIGIN}/events/11111111-1111-4111-8111-111111111111/resubmit`, async (route) => {
    const body = route.request().postDataJSON();
    expect(body.venue_requirements).toBe("Accessible main hall");
    await route.fulfill({ status: 200, json: { event: {
      ...CLARIFICATION_EVENT, title: "Campus workshop revised", venue_requirements: "Accessible main hall",
    } } });
  });
  await page.goto(`/events/${EVENT_ID}`);
  await expect(page.getByRole("heading", { name: "Changes requested" })).toBeVisible();
  await page.getByLabel("Venue requirements").fill("Accessible main hall");
  await page.getByRole("button", { name: "Revise and resubmit" }).click();
  await expect(page.getByRole("heading", { name: "Campus workshop revised" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Changes requested" })).toHaveCount(0);
});
