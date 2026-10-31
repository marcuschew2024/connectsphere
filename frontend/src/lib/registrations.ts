export type Registration = {
  id: string;
  reference?: string;
  event_id: string;
  status: "Registered" | "Waitlisted" | "Withdrawn";
  registered_at: string;
  withdrawn_at?: string | null;
};

export type OwnRegistration = Registration & {
  withdrawn_at: string | null;
  event: {
    id: string;
    reference?: string;
    title: string | null;
    category: string | null;
    event_datetime: string | null;
    status: string;
  } | null;
};

// SCRUM-69 (D34): cancelling leaves the registration Registered, so the event status
// decides what an Attendee is told. A withdrawal stays visible as a withdrawal.
export function registrationStatus(status: string, eventStatus?: string | null) {
  if (eventStatus === "Cancelled" && status !== "Withdrawn") {
    return { label: "Event cancelled", heading: "Event cancelled",
      description: "This event has been cancelled and will not take place. You do not need to do anything." };
  }
  switch (status) {
    case "Registered": return { label: "Registered", heading: "Registration confirmed",
      description: "Your place is booked. A confirmation is also available on Home under Registration confirmations." };
    case "Waitlisted": return { label: "Waitlisted", heading: "Registration waitlisted",
      description: "You are on the waiting list. A place has not been confirmed." };
    case "Withdrawn": return { label: "Withdrawn", heading: "Registration withdrawn",
      description: "Your previous registration has been withdrawn." };
    default: return { label: "Status unavailable", heading: "Registration status unavailable",
      description: "Refresh your registrations to check your latest status." };
  }
}

export type RegistrationOffer = {
  event: {
    id: string;
    reference?: string;
    title: string | null;
    description: string | null;
    category: string | null;
    event_datetime: string | null;
    status: string;
    registration_requirements: string | null;
  };
  capacity: {
    capacity: number | null;
    registered_count: number;
    remaining: number;
    is_full: boolean;
  };
  withdrawal_policy?: { closes_at: string | null; unavailable_reason: string | null };
  unavailable_reason: string | null;
  registration?: Registration | null;
};

export function eventTime(value: string | null) {
  return value ? `${new Date(value).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short",
  })} (Singapore)` : "Date not provided";
}
