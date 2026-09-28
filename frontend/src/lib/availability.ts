// Pure helpers for the venue availability calendar (SCRUM-30). No React, no fetch —
// so the free/busy/boundary logic is unit-testable in isolation.
//
// Model: everything is reduced to "minutes from the week's Monday 00:00 (Asia/Singapore)".
// The venue timezone is fixed to Asia/Singapore (SCRUM-24), which has no DST, so a fixed
// +8h offset is exact. Overlap is half-open [start, end): a booking that ends exactly when
// a cell starts does NOT make that cell busy (touching ≠ overlapping).
import { VENUE_DAYS, type OpeningHours } from "./venues";

const SGT_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CellState = "unavailable" | "available" | "tentative" | "confirmed" | "blocked";
// "blocked" = maintenance/blocked periods from SCRUM-31 (booking status 'Blocked').

export type CalendarBooking = { start_at: string; end_at: string; status: string };

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "09:00" -> 540 minutes. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** UTC ms of Monday 00:00 Asia/Singapore for the week containing `ref`. */
export function weekStartMs(ref: Date): number {
  const shifted = new Date(ref.getTime() + SGT_MS); // getUTC* now reads SGT wall-clock
  const daysFromMonday = (shifted.getUTCDay() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0
  const sgtMidnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return sgtMidnight - daysFromMonday * DAY_MS - SGT_MS; // Monday 00:00 SGT, back in real UTC
}

/** The hourly row range to render: min opens .. max closes across the week (fallback 8–20). */
export function hourWindow(hours: OpeningHours): { startHour: number; endHour: number } {
  let minOpen = Infinity;
  let maxClose = -Infinity;
  for (const day of VENUE_DAYS) {
    const oh = hours[day];
    if (!oh) continue;
    minOpen = Math.min(minOpen, toMinutes(oh.opens));
    maxClose = Math.max(maxClose, toMinutes(oh.closes));
  }
  if (!Number.isFinite(minOpen)) return { startHour: 8, endHour: 20 };
  return { startHour: Math.floor(minOpen / 60), endHour: Math.ceil(maxClose / 60) };
}

/**
 * Classify one 1-hour cell of the week grid.
 * Precedence: outside operating hours -> unavailable; else a confirmed booking wins over a
 * pending one; else available.
 */
export function classifyCell(
  dayIndex: number,
  hour: number,
  hours: OpeningHours,
  bookings: CalendarBooking[],
  weekStart: number,
): CellState {
  const oh = hours[VENUE_DAYS[dayIndex]];
  if (!oh) return "unavailable"; // venue closed that day

  const dayStartMin = dayIndex * 1440;
  const cellStartMin = dayStartMin + hour * 60;
  const cellEndMin = cellStartMin + 60;
  const openMin = dayStartMin + toMinutes(oh.opens);
  const closeMin = dayStartMin + toMinutes(oh.closes);
  if (cellStartMin < openMin || cellEndMin > closeMin) return "unavailable"; // outside hours

  let tentative = false;
  let blocked = false;
  for (const b of bookings) {
    const bStartMin = (Date.parse(b.start_at) - weekStart) / 60000;
    const bEndMin = (Date.parse(b.end_at) - weekStart) / 60000;
    const overlaps = bStartMin < cellEndMin && cellStartMin < bEndMin; // half-open
    if (!overlaps) continue;
    if (b.status === "Confirmed") return "confirmed"; // confirmed wins outright
    if (b.status === "Blocked") blocked = true;
    else if (b.status === "Requested" || b.status === "Pending") tentative = true;
  }
  if (blocked) return "blocked";
  return tentative ? "tentative" : "available";
}

/** e.g. 9 -> "9am", 14 -> "2pm". */
export function formatHour(hour: number): string {
  const period = hour < 12 ? "am" : "pm";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${period}`;
}
