import { expect, it } from "vitest";
import { maintenanceConflictCountLabel } from "./venues";

it.each([
  [0, "0 bookings now overlap maintenance"],
  [1, "1 booking now overlap maintenance"],
  [2, "2 bookings now overlap maintenance"],
])("reports the affected booking count (%i) in the maintenance heading", (count, label) => {
  expect(maintenanceConflictCountLabel(count)).toBe(label);
});
