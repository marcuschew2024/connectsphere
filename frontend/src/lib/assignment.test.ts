import { describe, expect, it } from "vitest";
import { canReassign, coordinatorName, splitQueue } from "./assignment";
import type { EventRecord } from "./events";

function event(overrides: Partial<EventRecord>): EventRecord {
  return {
    id: crypto.randomUUID(), title: "Workshop", status: "Submitted", coordinator_id: null,
    submitted_at: "2026-10-01T00:00:00Z",
    ...overrides,
  } as EventRecord;
}

describe("splitQueue", () => {
  it("queues only unassigned submitted requests, oldest submission first", () => {
    const newer = event({ submitted_at: "2026-10-03T00:00:00Z" });
    const older = event({ submitted_at: "2026-10-01T00:00:00Z" });
    const routed = event({ coordinator_id: 2 });
    const cancelled = event({ status: "Cancelled" });

    const { unassigned, assigned } = splitQueue([newer, routed, older, cancelled]);

    expect(unassigned).toEqual([older, newer]);
    expect(assigned).toEqual([routed, cancelled]);
  });
});

describe("canReassign", () => {
  it.each(["Submitted", "Planning", "Confirmed", "Preparation"] as const)("allows %s", (status) => {
    expect(canReassign({ status })).toBe(true);
  });

  it.each(["Completed", "Rejected", "Cancelled"] as const)("refuses closed %s", (status) => {
    expect(canReassign({ status })).toBe(false);
  });
});

describe("coordinatorName", () => {
  const coordinators = [{ id: 2, display_name: "Demo Coordinator" }];

  it("names known, unknown and missing Coordinators", () => {
    expect(coordinatorName(coordinators, 2)).toBe("Demo Coordinator");
    expect(coordinatorName(coordinators, 9)).toBe("Coordinator #9");
    expect(coordinatorName(coordinators, null)).toBe("Unassigned");
  });
});
