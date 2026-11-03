import { expect, it } from "vitest";
import { activeClosure, venueMoment, venueStatus, type Venue, type VenueBlock } from "./venues";

const venue = { id: "v", name: "Hall", location: "Campus", capacity: 30 } as unknown as Venue;
function closure(start: string, end: string, reason = "Maintenance"): VenueBlock {
  return { id: `${start}-${end}`, start_at: start, end_at: end, reason };
}
const NOW = Date.parse("2026-11-10T04:00:00Z");

it("finds the closure running now and ignores closures that have not started", () => {
  const running = closure("2026-11-10T02:00:00Z", "2026-11-10T06:00:00Z");
  const later = closure("2026-11-20T02:00:00Z", "2026-11-20T06:00:00Z", "Renovation");
  expect(activeClosure([later, running], NOW)).toBe(running);
  expect(activeClosure([later], NOW)).toBeNull();
  expect(activeClosure([], NOW)).toBeNull();
});

it("treats a closure as over at the instant it ends, and started at the instant it begins", () => {
  expect(activeClosure([closure("2026-11-10T00:00:00Z", "2026-11-10T04:00:00Z")], NOW)).toBeNull();
  const starting = closure("2026-11-10T04:00:00Z", "2026-11-10T08:00:00Z");
  expect(activeClosure([starting], NOW)).toBe(starting);
});

it("reports a venue with no running closure as active", () => {
  expect(venueStatus(venue, null)).toBe("Active");
});

it("names the reason and the end of a running closure", () => {
  const running = closure("2026-11-10T02:00:00Z", "2026-11-10T06:00:00Z", "Renovation");
  expect(venueStatus(venue, running)).toBe(
    `Blocked — Renovation until ${venueMoment(running.end_at)}`,
  );
});

it("reports a retired venue as retired even while a closure is running", () => {
  const retired = { ...venue, is_retired: true };
  expect(venueStatus(retired, null)).toBe("Retired");
  expect(venueStatus(retired, closure("2026-11-10T02:00:00Z", "2026-11-10T06:00:00Z"))).toBe("Retired");
});

it("shows a moment in Singapore time", () => {
  expect(venueMoment("2026-11-10T06:00:00Z")).toContain("2:00 pm");
});
