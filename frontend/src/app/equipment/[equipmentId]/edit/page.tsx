"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api";
import type { Equipment } from "@/lib/equipment";
import EquipmentForm from "../../equipment-form";
import EquipmentWorkspace from "../../equipment-workspace";

function Editor({ id }: { id: string }) {
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ equipment: Equipment }>(`/equipment/${id}`, { signal: controller.signal })
      .then((data) => setEquipment(data.equipment))
      .catch((problem) => { if (!controller.signal.aborted) setError(problem.message); });
    return () => controller.abort();
  }, [id]);

  if (error) return (
    <div className="space-y-3">
      <p role="alert" className="text-sm text-destructive">{error}</p>
      <Button asChild variant="outline"><Link href="/equipment">Back to catalogue</Link></Button>
    </div>
  );
  if (!equipment) return <p role="status">Loading equipment…</p>;
  return <EquipmentForm equipment={equipment} />;
}

export default function EditEquipmentPage() {
  const { equipmentId } = useParams<{ equipmentId: string }>();
  return (
    <EquipmentWorkspace title="Edit equipment" editing description="Keep stock details and condition up to date. Every saved change is recorded.">
      {(role) => <Editor key={`${role}-${equipmentId}`} id={equipmentId} />}
    </EquipmentWorkspace>
  );
}
