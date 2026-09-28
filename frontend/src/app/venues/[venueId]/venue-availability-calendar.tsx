"use client";

import {
  classifyCell,
  formatHour,
  hourWindow,
  DAY_LABELS,
  type CalendarBooking,
  type CellState,
} from "@/lib/availability";
import type { OpeningHours } from "@/lib/venues";

const SGT_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const CELL_STYLES: Record<CellState, string> = {
  available: "bg-emerald-50 dark:bg-emerald-500/10",
  tentative: "bg-amber-100 dark:bg-amber-500/25",
  confirmed: "bg-red-100 dark:bg-red-500/25",
  blocked: "bg-slate-300 dark:bg-slate-500/40",
  unavailable: "bg-muted/50",
};
const CELL_LABEL: Record<CellState, string> = {
  available: "Available",
  tentative: "Tentative hold",
  confirmed: "Confirmed",
  blocked: "Blocked (maintenance)",
  unavailable: "Unavailable",
};

// Read-only week availability grid (SCRUM-30). Free/busy come from the verified classifier;
// this component only renders. Maintenance/blocked is a stubbed legend entry (no data yet).
export default function VenueAvailabilityCalendar({
  hours,
  bookings,
  weekStart,
}: {
  hours: OpeningHours;
  bookings: CalendarBooking[];
  weekStart: number;
}) {
  const { startHour, endHour } = hourWindow(hours);
  const rows = Array.from({ length: Math.max(endHour - startHour, 1) }, (_, i) => startHour + i);

  // Read the SGT date parts for a day column by shifting into SGT wall-clock.
  const dayDate = (i: number) => new Date(weekStart + i * DAY_MS + SGT_MS);
  const weekLabel = `${dayDate(0).getUTCDate()}/${dayDate(0).getUTCMonth() + 1} – ${dayDate(6).getUTCDate()}/${dayDate(6).getUTCMonth() + 1}`;

  return (
    <section aria-label="Venue availability" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Availability <span className="text-sm font-normal text-muted-foreground">· week of {weekLabel}</span></h2>
        <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {(["available", "tentative", "confirmed", "blocked", "unavailable"] as CellState[]).map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={`inline-block size-3 rounded-sm border border-border ${CELL_STYLES[s]}`} aria-hidden="true" />
              {CELL_LABEL[s]}
            </li>
          ))}
        </ul>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card p-2 shadow-sm">
        <table className="w-full border-separate border-spacing-0.5 text-center text-xs">
          <thead>
            <tr>
              <th className="w-14 p-1 font-normal text-muted-foreground" scope="col"><span className="sr-only">Time</span></th>
              {DAY_LABELS.map((label, i) => (
                <th key={label} scope="col" className="p-1 font-medium">
                  {label} <span className="block font-normal text-muted-foreground">{dayDate(i).getUTCDate()}/{dayDate(i).getUTCMonth() + 1}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((hour) => (
              <tr key={hour}>
                <th scope="row" className="p-1 text-right align-top font-normal text-muted-foreground">{formatHour(hour)}</th>
                {DAY_LABELS.map((label, dayIndex) => {
                  const state = classifyCell(dayIndex, hour, hours, bookings, weekStart);
                  return (
                    <td
                      key={label}
                      className={`h-7 rounded-sm ${CELL_STYLES[state]}`}
                      aria-label={`${label} ${formatHour(hour)}: ${CELL_LABEL[state]}`}
                      title={`${label} ${formatHour(hour)} — ${CELL_LABEL[state]}`}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
