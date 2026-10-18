"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { equipmentTimestamp } from "@/lib/equipment";
import type { EquipmentRequest } from "@/lib/equipment-requests";
import { Button } from "@/components/ui/button";
import EquipmentWorkspace from "../equipment-workspace";

function RequestList({ role }: { role: string }) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<{ requests: EquipmentRequest[]; has_more: boolean } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ requests: EquipmentRequest[]; has_more: boolean }>(`/equipment/requests?page=${page}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : "Could not load requests."); });
    return () => controller.abort();
  }, [page, retry]);

  function changePage(next: number) { setData(null); setError(""); setPage(next); }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{role === "Tech Support" ? "Requests routed to your team." : "Requests for your assigned events."} Stock is reserved separately.</p>
      {role === "Coordinator" && <Link href="/equipment/requests/new" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Request equipment</Link>}
    </div>
    {error ? <div role="alert" className="rounded-xl border border-destructive/30 bg-card p-5">
      <p className="text-sm text-destructive">{error}</p>
      <Button variant="outline" className="mt-3" onClick={() => { setError(""); setRetry(value => value + 1); }}>Try again</Button>
    </div> : !data ? <p role="status">Loading requests…</p> : <>
      {data.requests.length === 0 && <p role="status" className="rounded-xl border border-border bg-card p-6 text-muted-foreground">No equipment requests on this page.</p>}
      {data.requests.map(request => <article key={request.id} className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-semibold">{request.event.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Event: {equipmentTimestamp(request.event.event_datetime)} SGT</p>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{request.status} · {request.routed_to}</span>
        </header>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {request.items.map(item => <li key={item.equipment_id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0"><h3 className="break-words text-sm font-semibold">{item.equipment_type}</h3><p className="break-words text-xs text-muted-foreground">{item.location}</p></div>
              <span className="shrink-0 text-sm font-semibold">Qty {item.quantity}</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.technical_notes || "No technical notes."}</p>
          </li>)}
        </ul>
        <footer className="space-y-1 text-xs text-muted-foreground">
          <p>Requested by {request.requester.display_name} · {equipmentTimestamp(request.requested_at)} SGT</p>
          <p className="break-all">Request reference: {request.id}</p>
          <p className="break-all">Event reference: {request.event_id}</p>
          {request.updated_at && <p>Last status update: {equipmentTimestamp(request.updated_at)} SGT</p>}
        </footer>
        <Link href={`/equipment/requests/${request.id}`} className="inline-flex rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
          {role === "Tech Support" ? "Review request" : "View request"}
        </Link>
      </article>)}
      <nav aria-label="Request pages" className="flex items-center justify-between gap-3">
        <Button variant="outline" disabled={page === 1} onClick={() => changePage(page - 1)}>Previous</Button>
        <span className="text-sm text-muted-foreground">Page {page}</span>
        <Button variant="outline" disabled={!data.has_more} onClick={() => changePage(page + 1)}>Next</Button>
      </nav>
    </>}
  </div>;
}

export default function EquipmentRequestsPage() {
  return <EquipmentWorkspace title="Equipment requests" description="Event requirements, quantities and submission records in one place.">
    {role => <RequestList key={role} role={role} />}
  </EquipmentWorkspace>;
}
