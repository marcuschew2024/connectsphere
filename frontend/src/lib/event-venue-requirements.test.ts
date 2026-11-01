import { describe, expect, it } from "vitest";
import type { CoordinatorEventRecord } from "./events";
import { eventVenueRequirements, singaporeDateTime } from "./event-venue-requirements";

describe("eventVenueRequirements", () => {
  it("derives all booking fields from an event", () => {
    const event = {
      expected_attendance: 150,
      event_datetime: "2026-10-20T06:00:00Z",
      venue_requirements: "Projector, Banquet, Wi-Fi, Blinds",
      facility_requirements: "Projector, Wi-Fi",
      accessibility_requirements: "Wheelchair",
    } as CoordinatorEventRecord;

    expect(eventVenueRequirements(event)).toEqual({
      attendance: "150",
      layout: "Banquet",
      layouts: ["Banquet"],
      customLayouts: [],
      facilities: ["Projector", "Wi-Fi"],
      customFacilities: ["Blinds"],
      accessibility: ["Wheelchair"],
      customAccessibility: [],
      date: "2026-10-20",
      startTime: "14:00",
      endTime: "",
    });
  });

  it("handles missing optional event requirements", () => {
    expect(eventVenueRequirements(undefined)).toEqual({
      attendance: "",
      layout: "",
      layouts: [],
      customLayouts: [],
      facilities: [],
      customFacilities: [],
      accessibility: [],
      customAccessibility: [],
      date: "",
      startTime: "",
      endTime: "",
    });
  });

  it("classifies Seminar Room as a custom layout and not a facility", () => {
    const result = eventVenueRequirements({
      venue_requirements: "U-shape, Seminar Room",
      facility_requirements: "Projector, Wi-Fi",
    } as CoordinatorEventRecord);

    expect(result.layouts).toEqual(["U-shape"]);
    expect(result.customLayouts).toEqual(["Seminar Room"]);
    expect(result.facilities).toEqual(["Projector", "Wi-Fi"]);
    expect(result.customFacilities).toEqual([]);
  });

  it("handles invalid event timestamps and leaves end time empty", () => {
    expect(singaporeDateTime("not-a-date")).toEqual({ date: "", time: "" });
    expect(eventVenueRequirements({
      event_datetime: "2026-10-20T15:30:00Z",
    } as CoordinatorEventRecord).endTime).toBe("");
  });
});
