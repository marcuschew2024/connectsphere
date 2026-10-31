import { describe, expect, it } from "vitest";
import { attendeeNoticeLink, notificationLink } from "./notification-links";

const EVENT = "11111111-1111-4111-8111-111111111111";

const SUBJECT = "22222222-2222-4222-8222-222222222222";

describe("notificationLink", () => {
  it("opens the exact booking request a Venue Staff notice is about", () => {
    expect(notificationLink("venue_booking_requested", EVENT, SUBJECT)).toEqual({
      href: `/venues/bookings/${SUBJECT}`, label: "Review this booking request" });
  });

  it("opens the exact equipment request a Tech Support notice is about", () => {
    expect(notificationLink("equipment_request_submitted", EVENT, SUBJECT)).toEqual({
      href: `/equipment/requests/${SUBJECT}`, label: "Review this equipment request" });
  });

  it("sends an older Venue Staff notice without a subject to the queue", () => {
    expect(notificationLink("venue_booking_requested", EVENT)).toEqual({
      href: "/venues/bookings", label: "Review booking requests" });
  });

  it("sends an older Tech Support notice without a subject to the queue", () => {
    expect(notificationLink("equipment_request_submitted", EVENT)).toEqual({
      href: "/equipment/requests", label: "Review equipment requests" });
  });

  it("gives a moved-away Coordinator no link", () => {
    expect(notificationLink("coordinator_unassigned", EVENT)).toBeNull();
  });

  it.each(["event_approved", "event_rejected", "event_clarification", "coordinator_assigned",
    "request_assigned", "event_re_review_required", "booking_rejected", "venue_unavailable"])(
    "opens the event for %s", (type) => {
      expect(notificationLink(type, EVENT)).toEqual({ href: `/events/${EVENT}`, label: "View request" });
    });
});

describe("attendeeNoticeLink", () => {
  it("lists a cancelled event in the attendee's registrations", () => {
    expect(attendeeNoticeLink("event_cancelled", EVENT).href).toBe("/registrations");
  });

  it.each(["registration_confirmed", "registration_withdrawn", undefined])("opens the event for %s", (type) => {
    expect(attendeeNoticeLink(type, EVENT).href).toBe(`/events/browse/${EVENT}`);
  });
});
