"use client";

import EquipmentForm from "../equipment-form";
import EquipmentWorkspace from "../equipment-workspace";

export default function NewEquipmentPage() {
  return (
    <EquipmentWorkspace title="Add equipment" editing description="Record the stock your team manages and its current condition.">
      {(role) => <EquipmentForm key={role} />}
    </EquipmentWorkspace>
  );
}
