export type RequestEvent = { id: string; title: string; event_datetime: string };

export const REQUEST_STATUSES = ["Requested", "Reserved", "Partially fulfilled", "Unavailable"] as const;
export type RequestStatus = typeof REQUEST_STATUSES[number];

export type RequestHistory = {
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
  event_id: string;
  status: RequestStatus;
  revision: number;
  update_notes: string;
  updated_by: number | null;
  updated_at: string | null;
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
    technical_notes: string;
  }[];
};

export type EquipmentRequestHeader = Omit<EquipmentRequest, "event" | "requester" | "items">;
