import { describe, expect, it } from "vitest";
import { filterSupervisedEvents, groupSupervisedEvents } from "./supervised-events";
import type { EventRecord } from "./events";

const event = (overrides: Partial<EventRecord>): EventRecord => ({
  id: "id", title: "Campus Workshop", reference: "EVT-001", status: "Submitted",
  coordinator_id: null, submitted_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z", ...overrides,
} as EventRecord);

describe("Lead overview", () => {
  it("separates closed records from active assignments and never shows private drafts", () => {
    const queued = event({});
    const legacy = event({ id: "legacy", status: "Planning" });
    const assigned = event({ id: "assigned", coordinator_id: 2 });
    const closed = event({ id: "closed", status: "Cancelled", coordinator_id: 2 });
    const rejected = event({ id: "rejected", status: "Rejected" });
    const draft = event({ id: "draft", status: "Draft" });
    expect(groupSupervisedEvents([queued, assigned, closed, draft, legacy, rejected])).toEqual({
      unassigned: [queued, legacy], assigned: [assigned], past: [closed, rejected],
    });
  });
  it("prioritises oldest waiting requests and most recent assignments", () => {
    const earlier = event({ id: "earlier" });
    const later = event({ id: "later", submitted_at: "2026-10-03T00:00:00Z" });
    const first = event({ id: "first", coordinator_id: 2, coordinator_assigned_at: "2026-10-01T00:00:00Z" });
    const latest = event({ id: "latest", coordinator_id: 2, coordinator_assigned_at: "2026-10-03T00:00:00Z" });
    const source = [later, first, earlier, latest];
    const result = groupSupervisedEvents(source);
    expect(result.unassigned).toEqual([earlier, later]);
    expect(result.assigned).toEqual([latest, first]);
    expect(source).toEqual([later, first, earlier, latest]);
  });
  it("combines reference/name search with Coordinator and status filters", () => {
    const target = event({ coordinator_id: 2, status: "Planning" });
    const other = event({ id: "other", reference: "EVT-002", coordinator_id: 3, status: "Planning" });
    expect(filterSupervisedEvents([target, other], " evt-001 ", "2", "Planning")).toEqual([target]);
    expect(filterSupervisedEvents([target, other], "campus", "3", "Planning")).toEqual([other]);
    expect(filterSupervisedEvents([target, other], "", "all", "Completed")).toEqual([]);
    expect(filterSupervisedEvents([target, event({})], "", "unassigned", "all")).toEqual([event({})]);
  });
});
