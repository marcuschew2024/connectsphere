// SCRUM-155: where a notification's link goes, so every recipient can open it.
// Venue Staff and Tech Support are notified as a pool and are not related users of the
// event, so their notices open the review queue rather than the event page.
export type NoticeLink = { href: string; label: string } | null;

export function notificationLink(type: string, eventId: string): NoticeLink {
  switch (type) {
    case "venue_booking_requested":
      return { href: "/venues/bookings", label: "Review booking requests" };
    case "equipment_request_submitted":
      return { href: "/equipment/requests", label: "Review equipment requests" };
    case "coordinator_unassigned":
      return null; // A Coordinator moved off an event can no longer open it.
    default:
      return { href: `/events/${eventId}`, label: "View request" };
  }
}

// Attendees open the public event page; a cancelled event is listed in their registrations.
export function attendeeNoticeLink(type: string | undefined, eventId: string): { href: string; label: string } {
  return type === "event_cancelled"
    ? { href: "/registrations", label: "View my registrations" }
    : { href: `/events/browse/${eventId}`, label: "View event" };
}
