import { expect, it } from "vitest";
import { classifyCell, weekStartMs, type CalendarBooking } from "./availability";
import { VENUE_DAYS, type OpeningHours } from "./venues";

const hours = Object.fromEntries(VENUE_DAYS.map(day => [day, { opens: "00:00", closes: "23:59" }])) as OpeningHours;
const week = weekStartMs(new Date("2099-10-20T14:00:00+08:00"));
const confirmed: CalendarBooking = {
  start_at: "2099-10-20T06:00:00Z", end_at: "2099-10-20T07:00:00Z", status: "Confirmed",
  occupied_start: "2099-10-20T05:30:00Z", occupied_end: "2099-10-20T07:45:00Z",
};

it.each([
  ["setup", "05:45", "06:00", 13],
  ["turnaround", "07:00", "07:30", 15],
] as const)("maintenance in %s remains visible over a confirmed booking in either record order", (_, start, end, hour) => {
  const block = { start_at: `2099-10-20T${start}:00Z`, end_at: `2099-10-20T${end}:00Z`, status: "Blocked" };
  expect(classifyCell(1, hour, hours, [confirmed, block], week)).toBe("blocked");
  expect(classifyCell(1, hour, hours, [block, confirmed], week)).toBe("blocked");
  expect(classifyCell(1, hour, hours, [confirmed], week)).toBe("confirmed");
  expect(confirmed.status).toBe("Confirmed");
});
