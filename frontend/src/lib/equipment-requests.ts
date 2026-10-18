export type RequestEvent = { id: string; title: string; event_datetime: string };

export type EquipmentRequest = {
  id: string;
  event_id: string;
  status: "Requested";
  routed_to: "Tech Support";
  requested_by: number;
  requested_at: string;
  event: RequestEvent;
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
