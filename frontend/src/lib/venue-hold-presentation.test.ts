// SCRUM-79 + SCRUM-129: the wording the hold and buffer-conflict screens depend on.
// These are pure so each fallback is asserted directly rather than through a rendered page.
import { describe, expect, it } from "vitest";
import { bookingChangeRefusal, canCancelBooking, canChangeBooking, holdDeadlineClause,
  type BookingRecord, type BookingStatus } from "./bookings";
import { conflictCountLabel, conflictEventLabel } from "./venues";

describe("holdDeadlineClause", () => {
  it("names the deadline when the hold has one", () => {
    const clause = holdDeadlineClause("2099-10-02T00:00:00Z");
    expect(clause.startsWith(" until ")).toBe(true);
    expect(clause).toContain(new Date("2099-10-02T00:00:00Z").toLocaleString());
  });

  it.each([null, undefined, ""])("reads correctly without a deadline (%s)", (value) => {
    // "This booking is tentatively held." must still be a sentence.
    expect(holdDeadlineClause(value)).toBe("");
  });
});

describe("conflictCountLabel", () => {
  it("uses the singular for one affected booking", () => {
    expect(conflictCountLabel(1)).toBe("1 existing booking now conflict");
  });

  it.each([0, 2, 7])("uses the plural for %i", (count) => {
    expect(conflictCountLabel(count)).toBe(`${count} existing bookings now conflict`);
  });
});

describe("conflictEventLabel", () => {
  it("prefers the event's own title", () => {
    expect(conflictEventLabel("Science Fair", "Untitled event")).toBe("Science Fair");
  });

  it.each([
    [null, "Untitled event"],
    [undefined, "another booking"],
  ])("falls back to the caller's stand-in for %s", (title, fallback) => {
    expect(conflictEventLabel(title, fallback)).toBe(fallback);
  });
});

describe("bookingChangeRefusal", () => {
  const mine = { isCoordinator: true, canManage: true };

  it("permits a change to the assigned Coordinator on a Requested booking", () => {
    expect(bookingChangeRefusal("Requested", mine)).toBeNull();
  });

  it("names the assignment when the Coordinator does not hold the event", () => {
    const refusal = bookingChangeRefusal("Requested", { isCoordinator: true, canManage: false });
    expect(refusal).toContain("Coordinator assigned to this event");
  });

  it.each(["Confirmed", "Held", "Rejected", "Cancelled", "Expired", "Blocked", "Pending"] as const)(
    "names the state, not the assignment, for a %s booking",
    (status) => {
      const refusal = bookingChangeRefusal(status, mine)!;
      // The old wording blamed the assignment for every refusal, which sent a Coordinator
      // looking at permissions when the real reason was that the booking was decided.
      expect(refusal).toContain(status.toLowerCase());
      expect(refusal).not.toContain("Coordinator assigned");
    },
  );

  it("refuses a non-Coordinator outright", () => {
    const refusal = bookingChangeRefusal("Requested", { isCoordinator: false, canManage: true });
    expect(refusal).toContain("event's Coordinator");
  });
});

describe("canChangeBooking / canCancelBooking", () => {
  const booking = (status: BookingStatus, can_manage?: boolean) =>
    ({ status, can_manage }) as BookingRecord;

  it("offers a change only while the booking is Requested", () => {
    expect(canChangeBooking(booking("Requested", true))).toBe(true);
    // The API accepts no change once decided, so offering one strands the Coordinator on
    // a read-only page -- which is exactly what happened before this gate existed.
    expect(canChangeBooking(booking("Confirmed", true))).toBe(false);
    expect(canChangeBooking(booking("Expired", true))).toBe(false);
  });

  it("offers a cancellation on a Requested or Confirmed booking", () => {
    expect(canCancelBooking(booking("Requested", true))).toBe(true);
    expect(canCancelBooking(booking("Confirmed", true))).toBe(true);
    expect(canCancelBooking(booking("Held", true))).toBe(false);
  });

  it("offers nothing to a Coordinator who no longer holds the event", () => {
    expect(canChangeBooking(booking("Requested", false))).toBe(false);
    expect(canCancelBooking(booking("Confirmed", false))).toBe(false);
  });

  it("falls back to offering actions when the server did not say", () => {
    // Older responses carry no can_manage; the server still refuses an unauthorised write.
    expect(canChangeBooking(booking("Requested"))).toBe(true);
    expect(canCancelBooking(booking("Confirmed"))).toBe(true);
  });
});
