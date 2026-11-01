import { describe, expect, it } from "vitest";
import { classifyCell, weekStartMs, type CalendarBooking } from "./availability";
import { VENUE_DAYS, type OpeningHours } from "./venues";

const hours = Object.fromEntries(VENUE_DAYS.map(day => [day, { opens: "09:00", closes: "18:00" }])) as OpeningHours;
const week = weekStartMs(new Date("2099-10-20T14:00:00+08:00"));
const booking: CalendarBooking = {
  start_at: "2099-10-20T06:00:00Z", end_at: "2099-10-20T07:00:00Z", status: "Confirmed",
  occupied_start: "2099-10-20T05:30:00Z", occupied_end: "2099-10-20T07:30:00Z",
};

describe("calendar occupancy from the persisted booking interval", () => {
  it("marks setup and turnaround hours busy without changing the event's actual time", () => {
    const before = { ...booking };
    for (const hour of [13, 14, 15]) {
      expect(classifyCell(1, hour, hours, [booking], week)).toBe("confirmed");
    }
    expect(classifyCell(1, 12, hours, [booking], week)).toBe("available");
    expect(classifyCell(1, 16, hours, [booking], week)).toBe("available");
    expect(classifyCell(2, 14, hours, [booking], week)).toBe("available");
    expect(booking).toEqual(before);
  });

  it("keeps a touching occupied boundary free and uses tentative styling for a request", () => {
    const tentative = { ...booking, status: "Requested", occupied_end: "2099-10-20T08:00:00Z" };
    expect(classifyCell(1, 13, hours, [tentative], week)).toBe("tentative");
    expect(classifyCell(1, 15, hours, [tentative], week)).toBe("tentative");
    expect(classifyCell(1, 16, hours, [tentative], week)).toBe("available");
  });

  it("keeps raw maintenance intervals and null legacy occupied fields compatible", () => {
    const maintenance = { start_at: booking.start_at, end_at: booking.end_at, status: "Blocked" };
    const legacy = { ...booking, occupied_start: null, occupied_end: null };
    for (const record of [maintenance, legacy]) {
      expect(classifyCell(1, 13, hours, [record], week)).toBe("available");
      expect(classifyCell(1, 15, hours, [record], week)).toBe("available");
    }
    expect(classifyCell(1, 14, hours, [maintenance], week)).toBe("blocked");
    expect(classifyCell(1, 14, hours, [legacy], week)).toBe("confirmed");
  });
});
