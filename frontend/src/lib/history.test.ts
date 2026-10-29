import { describe, expect, it } from "vitest";
import { historyActionLabel } from "./history";

describe("historyActionLabel", () => {
  it.each([
    ["coordinator_assigned", "Coordinator Assigned"],
    ["coordinator_reassigned", "Coordinator Reassigned"],
    ["change_request_approved", "Change Request Approved"],
    ["event_completed", "Event completed"],
  ])("labels %s", (action, label) => {
    expect(historyActionLabel(action)).toBe(label);
  });

  it("turns an unlabelled action into words instead of showing snake_case", () => {
    expect(historyActionLabel("safety_check_requested")).toBe("Safety Check Requested");
  });
});
