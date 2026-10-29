export type Registration = {
  id: string;
  event_id: string;
  status: "Registered" | "Waitlisted" | "Withdrawn";
  registered_at: string;
};

export type OwnRegistration = Registration & {
  withdrawn_at: string | null;
  event: {
    id: string;
    title: string | null;
    category: string | null;
    event_datetime: string | null;
    status: string;
  } | null;
};

export function registrationStatus(status: string) {
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
  unavailable_reason: string | null;
  registration?: Registration | null;
};

export function eventTime(value: string | null) {
  return value ? `${new Date(value).toLocaleString("en-SG", {
    timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short",
  })} (Singapore)` : "Date not provided";
}
