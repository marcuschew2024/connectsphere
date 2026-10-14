export const EQUIPMENT_STATUSES = ["Operational", "Damaged", "Under Maintenance"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export type Equipment = {
  id: string;
  equipment_type: string;
  description: string;
  total_quantity: number;
  location: string;
  operational_status: EquipmentStatus;
  // Usable stock before reservations, not availability for a particular event.
  usable_quantity: number;
  revision: number;
  created_by: number;
  created_at: string;
  updated_by: number;
  updated_at: string;
  creator?: { display_name: string } | null;
  editor?: { display_name: string } | null;
};

export function equipmentTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Singapore",
  }).format(new Date(value));
}
