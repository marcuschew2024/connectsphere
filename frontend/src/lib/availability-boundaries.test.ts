import { describe, expect, it } from "vitest";
import { classifyCell, formatHour, hourWindow, weekStartMs } from "./availability";
import { VENUE_DAYS, type OpeningHours } from "./venues";

const closed = Object.fromEntries(VENUE_DAYS.map((day) => [day, null])) as OpeningHours;
const hours = { ...closed, monday: { opens: "09:30", closes: "17:30" } };
const monday = Date.parse("2026-09-27T16:00:00Z");

describe("SCRUM-30 calendar boundaries", () => {
  it.each([
    "2026-09-28T00:00:00+08:00",
    "2026-10-04T23:59:59+08:00",
    "2026-09-27T16:00:00Z",
  ])("uses the same Singapore Monday for %s", (instant) => {
    expect(weekStartMs(new Date(instant))).toBe(monday);
  });

  it("advances to a new week at Singapore midnight, before UTC Monday", () => {
    expect(weekStartMs(new Date("2026-10-04T16:00:00Z"))).toBe(
      Date.parse("2026-10-04T16:00:00Z"),
    );
  });

  it("provides a display range when every day is closed", () => {
    expect(hourWindow(closed)).toEqual({ startHour: 8, endHour: 20 });
  });

  it("rounds partial opening hours outward but marks incomplete cells unavailable", () => {
    expect(hourWindow(hours)).toEqual({ startHour: 9, endHour: 18 });
    expect(classifyCell(0, 9, hours, [], monday)).toBe("unavailable");
    expect(classifyCell(0, 10, hours, [], monday)).toBe("available");
    expect(classifyCell(0, 17, hours, [], monday)).toBe("unavailable");
  });

  it.each(["Rejected", "Cancelled", "Unknown"])("does not occupy a slot for %s history", (status) => {
    expect(classifyCell(0, 10, hours, [{
      start_at: "2026-09-28T10:00:00+08:00",
      end_at: "2026-09-28T11:00:00+08:00",
      status,
    }], monday)).toBe("available");
  });

  it.each([[0, "12am"], [9, "9am"], [12, "12pm"], [14, "2pm"]])(
    "labels hour %s as %s", (hour, expected) => {
      expect(formatHour(hour as number)).toBe(expected);
    },
  );
});
