import { describe, expect, it } from "vitest";
import { classifyCell, hourWindow, toMinutes, weekStartMs, type CalendarBooking } from "./availability";
import { VENUE_DAYS, type OpeningHours } from "./venues";

// A venue open every day 09:00–18:00.
const allOpen: OpeningHours = Object.fromEntries(
  VENUE_DAYS.map((d) => [d, { opens: "09:00", closes: "18:00" }]),
) as OpeningHours;

const REF = new Date("2026-09-28T10:00:00+08:00");
const WS = weekStartMs(REF);
// Build an ISO instant for (dayIndex, hour) in SGT wall-clock.
const at = (day: number, hour: number) => new Date(WS + day * 86400000 + hour * 3600000).toISOString();
const booking = (day: number, from: number, to: number, status: string): CalendarBooking =>
  ({ start_at: at(day, from), end_at: at(day, to), status });

describe("toMinutes / hourWindow", () => {
  it("parses HH:MM", () => expect(toMinutes("14:30")).toBe(870));
  it("spans min opens..max closes", () =>
    expect(hourWindow(allOpen)).toEqual({ startHour: 9, endHour: 18 }));
});

describe("classifyCell", () => {
  it("is unavailable when the venue is closed that day", () => {
    const closedSun: OpeningHours = { ...allOpen, sunday: null };
    expect(classifyCell(6, 13, closedSun, [], WS)).toBe("unavailable");
  });

  it("is unavailable outside operating hours", () => {
    expect(classifyCell(0, 8, allOpen, [], WS)).toBe("unavailable"); // before 09:00
    expect(classifyCell(0, 17, allOpen, [], WS)).toBe("available"); // 17–18 is the last open hour
  });

  it("is available in-hours with no booking", () => {
    expect(classifyCell(0, 10, allOpen, [], WS)).toBe("available");
  });

  it("shows a confirmed booking as confirmed", () => {
    const b = [booking(0, 13, 14, "Confirmed")];
    expect(classifyCell(0, 13, allOpen, b, WS)).toBe("confirmed");
  });

  it("shows a requested or pending booking as tentative", () => {
    expect(classifyCell(0, 13, allOpen, [booking(0, 13, 14, "Requested")], WS)).toBe("tentative");
    expect(classifyCell(0, 13, allOpen, [booking(0, 13, 14, "Pending")], WS)).toBe("tentative");
  });

  it("shows a blocked/maintenance booking as blocked", () => {
    expect(classifyCell(0, 13, allOpen, [booking(0, 13, 14, "Blocked")], WS)).toBe("blocked");
  });

  it("lets confirmed win over an overlapping pending", () => {
    const b = [booking(0, 13, 15, "Pending"), booking(0, 13, 15, "Confirmed")];
    expect(classifyCell(0, 14, allOpen, b, WS)).toBe("confirmed");
  });

  it("treats a touching slot as free (boundary: end == next start)", () => {
    const b = [booking(0, 13, 14, "Confirmed")]; // 1–2pm
    expect(classifyCell(0, 13, allOpen, b, WS)).toBe("confirmed"); // the booked hour
    expect(classifyCell(0, 14, allOpen, b, WS)).toBe("available"); // 2–3pm touches, not overlaps
  });

  it("does not bleed a booking into another day", () => {
    const b = [booking(0, 13, 14, "Confirmed")];
    expect(classifyCell(1, 13, allOpen, b, WS)).toBe("available"); // Tuesday, same hour
  });
});
