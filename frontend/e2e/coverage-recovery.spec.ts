import { expect, test } from "./fixtures";

test("equipment conflict recovery reloads the latest persisted version", async ({ page }) => {
  const id = "11111111-1111-4111-8111-111111111111";
  const equipment = { id, equipment_type: "Microphone", description: "Original", total_quantity: 5, usable_quantity: 5,
    location: "Store", operational_status: "Operational", revision: 1, created_by: 4, updated_by: 4,
    created_at: "2099-10-01T00:00:00Z", updated_at: "2099-10-01T00:00:00Z" };
  let reads = 0;
  await page.route("**/session", route => route.fulfill({ json: { user: { id: 4, role: "Tech Support" } } }));
  await page.route(`**/equipment/${id}`, route => {
    if (route.request().method() === "PUT") return route.fulfill({ status: 409, json: { error: "A newer version exists." } });
    reads++; return route.fulfill({ json: { equipment: reads > 1 ? { ...equipment, description: "Updated by teammate", revision: 2 } : equipment } });
  });
  await page.goto(`/equipment/${id}/edit`);
  await page.getByLabel("Description", { exact: true }).fill("My unsaved edit");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("A newer version exists.");
  await page.getByRole("button", { name: "Reload latest" }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Updated by teammate");
  expect(reads).toBe(2);
});
