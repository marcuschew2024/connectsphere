import type { CoordinatorEventRecord } from "./events";
import { VENUE_LAYOUTS } from "./venues";

export function eventVenueRequirements(event: CoordinatorEventRecord | undefined) {
  const requirements = (event?.venue_requirements ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const layout = requirements.find((value) =>
    VENUE_LAYOUTS.some((supportedLayout) =>
      supportedLayout.toLowerCase() === value.toLowerCase()),
  );
  const singaporeStart = singaporeDateTime(event?.event_datetime);

  return {
    attendance: event?.expected_attendance != null ? String(event.expected_attendance) : "",
    layout: layout ?? "",
    specialRequirements: [
      ...requirements.filter((value) => value !== layout),
      event?.accessibility_requirements ?? "",
    ]
      .filter(Boolean)
      .join(", "),
    date: singaporeStart.date,
    startTime: singaporeStart.time,
    endTime: "",
  };
}

export function singaporeDateTime(value: string | null | undefined) {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}
