"use client";

import { recordReference } from "@/lib/record-reference";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Package, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api";
import { type Equipment, equipmentTimestamp } from "@/lib/equipment";
import EquipmentAvailabilityModal from "./equipment-availability-modal";
import EquipmentWorkspace from "./equipment-workspace";

type CatalogueResponse = { equipment: Equipment[]; page: number; has_more: boolean };

function CatalogueResults({
  role, page, operationalOnly, onPageChange,
}: {
  role: string;
  page: number;
  operationalOnly: boolean;
  onPageChange: (page: number) => void;
}) {
  const [data, setData] = useState<CatalogueResponse | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedItem, setSelectedItem] = useState<Equipment | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<CatalogueResponse>(`/equipment?page=${page}&operational_only=${operationalOnly}`, {
      signal: controller.signal,
    }).then(setData).catch((problem) => {
      if (!controller.signal.aborted) setError(problem.message || "Could not load equipment.");
    });
    return () => controller.abort();
  }, [page, operationalOnly, retry]);

  if (error) return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-6">
      <p role="alert" className="text-sm text-destructive">{error}</p>
      <Button variant="outline" onClick={() => { setError(""); setRetry(retry + 1); }}>Try again</Button>
    </div>
  );
  if (!data) return <p role="status" className="text-sm text-muted-foreground">Loading equipment…</p>;

  return (
    <div className="space-y-6">
      {data.equipment.length === 0 ? (
        <div role="status" className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <Package aria-hidden="true" className="mx-auto mb-3 size-8 text-muted-foreground" />
          <h2 className="font-semibold">{operationalOnly ? "No usable stock on this page" : "No equipment on this page"}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {operationalOnly ? "Clear the filter to see all conditions." : "Tech Support can add equipment to get started."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.equipment.map((item) => (
            <article key={item.id} aria-label={`${item.equipment_type} at ${item.location}`}
              className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5 shadow-sm">
              <Badge variant={item.operational_status === "Operational" ? "secondary" : "destructive"}>
                {item.operational_status}
              </Badge>
          {item.reference && <p className="text-xs text-muted-foreground">{recordReference(item, item.created_at)}</p>}
              <h2 className="mt-3 break-words text-lg font-semibold">{item.equipment_type}</h2>
              <p className="mt-1 break-words text-sm text-muted-foreground">{item.location}</p>
              <p className="my-4 whitespace-pre-wrap break-words text-sm">{item.description}</p>
              <dl className="mt-auto grid grid-cols-2 gap-3 rounded-xl bg-muted p-3 text-sm">
                <div><dt className="text-muted-foreground">Total Quantity</dt><dd className="mt-1 text-xl font-semibold">{item.total_quantity}</dd></div>
                <div><dt className="text-muted-foreground">Usable Stock</dt><dd className="mt-1 text-xl font-semibold">{item.usable_quantity}</dd></div>
              </dl>
              {item.operational_status !== "Operational" && (
                <p className="mt-3 text-sm text-destructive">Excluded from usable stock until operational.</p>
              )}
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                Updated by {item.editor?.display_name ?? `user ${item.updated_by}`}<br />
                <time dateTime={item.updated_at}>{equipmentTimestamp(item.updated_at)} SGT</time>
              </p>
              <div className="mt-4 grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
                <Button
                  variant="secondary"
                  className="w-full text-xs sm:text-sm"
                  onClick={() => setSelectedItem(item)}
                  aria-label={`Check availability for ${item.equipment_type}`}
                >
                  Check Availability
                </Button>
                {role === "Tech Support" && (
                  <Button asChild variant="outline" className="w-full text-xs sm:text-sm">
                    <Link href={`/equipment/${item.id}/edit`} aria-label={`Edit ${item.equipment_type} at ${item.location}`}>
                      Edit
                    </Link>
                  </Button>
                )}
              </div>

            </article>
          ))}
        </div>

      )}
      {selectedItem && (
        <EquipmentAvailabilityModal
          equipmentId={selectedItem.id}
          equipmentType={selectedItem.equipment_type}
          isOpen={Boolean(selectedItem)}
          role={role}
          onClose={() => setSelectedItem(null)}
        />
      )}

      <nav aria-label="Equipment catalogue pages" className="flex items-center justify-center gap-4">

        <Button variant="outline" disabled={page === 1} onClick={() => onPageChange(page - 1)}>Previous</Button>
        <span className="text-sm text-muted-foreground">Page {page}</span>
        <Button variant="outline" disabled={!data.has_more} onClick={() => onPageChange(page + 1)}>Next</Button>
      </nav>
    </div>
  );
}

function Catalogue({ role }: { role: string }) {
  const [page, setPage] = useState(1);
  const [operationalOnly, setOperationalOnly] = useState(false);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium select-none text-foreground">
          <input
            type="checkbox"
            checked={operationalOnly}
            className="size-4.5 rounded border-border text-primary accent-primary focus:ring-2 focus:ring-ring"
            onChange={(event) => { setOperationalOnly(event.target.checked); setPage(1); }}
          />
          <span>Show Usable Stock Only</span>
        </label>
        {role === "Tech Support" && (
          <Button asChild>
            <Link href="/equipment/new">
              <Plus aria-hidden="true" className="mr-1.5 size-4" />
              Add Equipment
            </Link>
          </Button>
        )}
      </div>

      <p className="rounded-xl border border-border/60 bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        Usable stock excludes damaged equipment and equipment under maintenance.
        It does not account for reservations for a particular event or time.
      </p>
      <CatalogueResults
        key={`${page}-${operationalOnly}`}
        role={role}
        page={page}
        operationalOnly={operationalOnly}
        onPageChange={setPage}
      />
    </div>
  );
}


export default function EquipmentPage() {
  return (
    <EquipmentWorkspace title="Equipment catalogue" description="Browse equipment, stock levels and condition across your locations.">
      {(role) => <Catalogue key={role} role={role} />}
    </EquipmentWorkspace>
  );
}
