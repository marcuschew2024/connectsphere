import type { CoordinatorEventRecord } from "./events";
import { VENUE_ACCESSIBILITY_FEATURES, VENUE_FACILITIES, VENUE_LAYOUTS } from "./venues";

const LEGACY_FACILITY_OTHER_VALUES = ["Blinds"];
const isLegacyFacilityOther = (value: string) =>
  LEGACY_FACILITY_OTHER_VALUES.some((facility) => facility.toLowerCase() === value.toLowerCase());

export function eventVenueRequirements(event: CoordinatorEventRecord | undefined) {
  const requirements = (event?.venue_requirements ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const layout = requirements.find((value) =>
    VENUE_LAYOUTS.some((supportedLayout) =>
      supportedLayout.toLowerCase() === value.toLowerCase()),
  );
  const layouts = requirements.filter((value) =>
    VENUE_LAYOUTS.some((supportedLayout) =>
      supportedLayout.toLowerCase() === value.toLowerCase()),
  );
  const facilities = requirements.filter((value) =>
    VENUE_FACILITIES.some((facility) => facility.toLowerCase() === value.toLowerCase()),
  );
  const legacyFacilityValues = requirements.filter(isLegacyFacilityOther);
  const storedFacilities = (event?.facility_requirements ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allFacilities = [...new Set([...storedFacilities, ...facilities, ...legacyFacilityValues])];
  const accessibility = (event?.accessibility_requirements ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const singaporeStart = singaporeDateTime(event?.event_datetime);

  return {
    attendance: event?.expected_attendance != null ? String(event.expected_attendance) : "",
    layout: layout ?? "",
    layouts,
    customLayouts: requirements.filter((value) =>
      !VENUE_LAYOUTS.some((supportedLayout) => supportedLayout.toLowerCase() === value.toLowerCase()) &&
      !VENUE_FACILITIES.some((facility) => facility.toLowerCase() === value.toLowerCase()) &&
      !isLegacyFacilityOther(value),
    ),
    facilities: allFacilities.filter((value) => VENUE_FACILITIES.some((facility) => facility.toLowerCase() === value.toLowerCase())),
    customFacilities: [...new Set([
      ...storedFacilities.filter((value) => !VENUE_FACILITIES.some((facility) => facility.toLowerCase() === value.toLowerCase())),
      ...legacyFacilityValues,
    ])],
    accessibility: accessibility.filter((value) => VENUE_ACCESSIBILITY_FEATURES.some((feature) => feature.toLowerCase() === value.toLowerCase())),
    customAccessibility: accessibility.filter((value) => !VENUE_ACCESSIBILITY_FEATURES.some((feature) => feature.toLowerCase() === value.toLowerCase())),
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
