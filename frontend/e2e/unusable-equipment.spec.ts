import { expect, test, type Page } from "@playwright/test";

// SCRUM-153 (SCRUM-63): reserved units on stock later marked Damaged / Under Maintenance
// do not count as reserved, and the request page says why.
const API = "http://localhost:5001";
const ID = "15300000-0000-4000-8000-000000000001";
const PATH = `/equipment/requests/${ID}`;

function requestWith(reserved: number, unusable: number) {
  return {
    id: ID, event_id: "15300000-0000-4000-8000-000000000002",
    status: reserved >= 2 ? "Reserved" : "Requested", revision: 2, update_notes: "",
    updated_by: 4, updated_at: "2026-10-30T08:00:00Z", requested_by: 2,
    requested_at: "2026-10-30T06:00:00Z", reservation_start_at: "2099-10-20T06:00:00Z",
    reservation_end_at: "2099-10-20T07:00:00Z", routed_to: "Tech Support",
    requester: { display_name: "Demo Coordinator" },
    event: { id: "15300000-0000-4000-8000-000000000002", title: "Community workshop",
      event_datetime: "2099-10-20T06:00:00Z", status: "Planning" },
    items: [{ equipment_id: "15300000-0000-4000-8000-000000000003", equipment_type: "Wireless microphone",
      location: "AV store", quantity: 2, position: 1, technical_notes: "Spare batteries",
      reserved_quantity: reserved, unusable_reserved_quantity: unusable }],
  };
}

async function open(page: Page, role: "Coordinator" | "Tech Support", request: object) {
  await page.route(`${API}/session`, (route) => route.fulfill({
    json: { user: { id: role === "Coordinator" ? 2 : 4, role } },
  }));
  await page.route(API + PATH, (route) => route.fulfill({ json: { request } }));
  await page.route(API + PATH + "/history?*", (route) => route.fulfill({ json: { history: [], has_more: false } }));
  await page.goto(PATH);
}

for (const role of ["Coordinator", "Tech Support"] as const) {
  test(`${role} sees that reserved units on damaged stock do not count`, async ({ page }) => {
    await open(page, role, requestWith(0, 2));

    await expect(page.getByText("Reserved 0 · Remaining 2")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "2 reserved units are on stock that is no longer operational" }))
      .toBeVisible();
  });
}

test("a fully usable reservation shows no damaged-stock warning", async ({ page }) => {
  await open(page, "Coordinator", requestWith(2, 0));

  await expect(page.getByText("Reserved 2 · Remaining 0")).toBeVisible();
  await expect(page.getByText("no longer operational")).toHaveCount(0);
});
