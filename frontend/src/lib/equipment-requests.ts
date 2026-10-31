export type RequestEvent = { id: string; reference?: string; title: string; event_datetime: string };

export const REQUEST_STATUSES = ["Requested", "Reserved", "Partially fulfilled", "Unavailable"] as const;
export type RequestStatus = typeof REQUEST_STATUSES[number];

export type RequestReservation = {
  id: string; equipment_id: string; quantity: number; start_at: string; end_at: string; status: string;
};

export type RequestHistory = {
  reservation_snapshot?: { start_at: string; end_at: string; items: { equipment_type: string; quantity: number }[] } | null;
  request_id: string;
  revision: number;
  from_status: RequestStatus;
  status: RequestStatus;
  notes: string;
  actor_id: number;
  actor_name: string;
  changed_at: string;
};

export type EquipmentRequest = {
  id: string;
  reference?: string;
  event_id: string;
  status: RequestStatus;
  revision: number;
  update_notes: string;
  updated_by: number | null;
  updated_at: string | null;
  reservation_start_at?: string | null;
  reservation_end_at?: string | null;
  reservations?: RequestReservation[];
  existing_reservations?: RequestReservation[];
  reported_status?: RequestStatus;
  routed_to: "Tech Support";
  requested_by: number;
  requested_at: string;
  event: RequestEvent & { status: string };
  requester: { display_name: string };
  items: {
    equipment_id: string;
    position: number;
    equipment_type: string;
    location: string;
    quantity: number;
    reserved_quantity?: number;
    // SCRUM-153: units still booked on Damaged / Under Maintenance stock (not counted).
    unusable_reserved_quantity?: number;
    technical_notes: string;
  }[];
};

export type EquipmentRequestHeader = Omit<EquipmentRequest, "event" | "requester" | "items">;
