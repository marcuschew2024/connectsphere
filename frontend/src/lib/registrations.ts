export type Registration = {
  id: string;
  event_id: string;
  status: "Registered" | "Withdrawn";
  registered_at: string;
};

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
