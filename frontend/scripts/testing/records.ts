import type { EventRecord } from "../../src/lib/events";
/** Complete baseline; individual cases change only the acceptance-relevant fields. */
export const eventRecord: EventRecord = {
  id: "event", title: "Workshop", description: "Campus workshop", purpose: "Learning", category: "Workshop",
  event_datetime: "2099-10-20T06:00:00Z", event_end_datetime: "2099-10-20T07:00:00Z", expected_attendance: 20, venue_requirements: "Classroom",
  facility_requirements: "Projector", accessibility_requirements: "Accessible entrance", equipment_requirements: "Microphone",
  registration_requirements: "", status: "Planning", organiser_id: 1, coordinator_id: 2, coordinator_assigned_at: null,
  created_at: "2099-10-01T00:00:00Z", updated_at: "2099-10-01T00:00:00Z", submitted_at: "2099-10-01T00:00:00Z",
  last_status_changed_by: 2, last_status_changed_at: "2099-10-01T00:00:00Z", decision_reason: null, decision_by: null, decision_at: null,
};

import type { EquipmentRequest } from "../../src/lib/equipment-requests";
export const equipmentRequest: EquipmentRequest = {
  id: "request", event_id: "event", status: "Requested", revision: 1, update_notes: "", updated_by: null, updated_at: null,
  routed_to: "Tech Support", requested_by: 2, requested_at: "2099-10-01T00:00:00Z",
  event: { id: "event", title: "Workshop", event_datetime: "2099-10-20T06:00:00Z", event_end_datetime: null, status: "Planning" },
  requester: { display_name: "Coordinator A" }, items: [
    { equipment_id: "mic", equipment_type: "Microphone", quantity: 2, position: 0, location: "Store", technical_notes: "" },
    { equipment_id: "projector", equipment_type: "Projector", quantity: 1, position: 1, location: "Store", technical_notes: "HDMI" },
  ],
};

import type { BookingRecord } from "../../src/lib/bookings";
import { defaultOpeningHours, type Venue } from "../../src/lib/venues";
export const bookingRecord: BookingRecord = {
  id: "booking", event_id: "event", venue_id: "venue", start_at: "2099-10-20T06:00:00Z", end_at: "2099-10-20T07:00:00Z",
  status: "Requested", decision_reason: null, suggested_alternative: null, decided_by: null, decision_at: null,
  requested_by: 2, requested_at: "2099-10-01T00:00:00Z", expected_attendance: 20, layout: "Classroom", special_requirements: null,
};
export const venueRecord: Venue = {
  id: "venue", name: "Hall", location: "Campus", capacity: 30, facilities: [], accessibility: [], supported_layouts: ["Classroom"],
  operating_hours: defaultOpeningHours(), timezone: "Asia/Singapore", created_by: 3, created_at: "2099-10-01T00:00:00Z", revision: 1,
};
