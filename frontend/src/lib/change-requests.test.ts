import { describe, expect, it } from "vitest";
import type { EventChangeRequest } from "./events";
import { changeFieldLabel, changeValue, needsReReview, proposedChanges } from "./change-requests";

const request = (extra: Partial<EventChangeRequest>): EventChangeRequest => ({
  id: 1, event_id: "event-138", requested_by: 1, description: "Change", status: "Pending",
  reviewed_by: null, review_note: null, requested_at: "2026-10-31T00:00:00Z", reviewed_at: null,
  ...extra,
});

describe("change request proposals (SCRUM-138)", () => {
  it("sends only filled-in values, trimmed, with attendance as a number", () => {
    expect(proposedChanges({ title: "  New title ", expected_attendance: " 120 ", purpose: "   " }))
      .toEqual({ title: "New title", expected_attendance: 120 });
  });

  it("sends no changes when nothing was filled in", () => {
    expect(proposedChanges({ title: "", venue_requirements: "  " })).toBeNull();
  });

  it("leaves a non-numeric attendance as typed so the API can explain the problem", () => {
    expect(proposedChanges({ expected_attendance: "lots" })).toEqual({ expected_attendance: "lots" });
  });

  it("labels fields and empty values for people", () => {
    expect(changeFieldLabel("expected_attendance")).toBe("Expected attendance");
    expect(changeFieldLabel("unknown_field")).toBe("unknown_field");
    expect(changeValue(null)).toBe("(none)");
    expect(changeValue(150)).toBe("150");
  });

  it("flags re-review only for an approved significant change", () => {
    expect(needsReReview(request({ status: "Approved", significant: true }))).toBe(true);
    expect(needsReReview(request({ status: "Implemented", significant: true }))).toBe(false);
    expect(needsReReview(request({ status: "Approved", significant: false }))).toBe(false);
    expect(needsReReview(request({ status: "Approved" }))).toBe(false);
  });
});
