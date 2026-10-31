"use client";

import { recordReference } from "@/lib/record-reference";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { equipmentTimestamp } from "@/lib/equipment";
import { type EquipmentRequest, type EquipmentRequestHeader, type RequestHistory, type RequestStatus } from "@/lib/equipment-requests";
import { Button } from "@/components/ui/button";
import EquipmentWorkspace from "../../equipment-workspace";
import ReservationForm from "./reservation-form";

const fieldClass = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function StatusForm({ request, onSaved, onReload }: {
  request: EquipmentRequest;
  onSaved: (saved: EquipmentRequestHeader) => void;
  onReload: () => void;
}) {
  const [status, setStatus] = useState<RequestStatus>(request.status);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || needsReload) return;
    setBusy(true); setError("");
    try {
      const result = await apiRequest<{ request: EquipmentRequestHeader }>(`/equipment/requests/${request.id}/status`, {
        method: "PATCH", body: JSON.stringify({ status, notes, revision: request.revision }),
      });
      onSaved(result.request);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not confirm the update. Reload the request before retrying.");
      // A network/server failure may have committed: re-read before trying another write.
      setNeedsReload(!(cause instanceof ApiError) || cause.status === 409 || cause.status >= 500);
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6" aria-label="Update request status">
    <div><h2 className="text-lg font-semibold">Update request status</h2>
      <p className="mt-1 text-sm text-muted-foreground">Use Requested while arranging equipment, or Unavailable if it cannot be supplied. Saving reserved quantities above sets Reserved or Partially fulfilled automatically.</p></div>
    {error && <div ref={alert} tabIndex={-1} role="alert" className="space-y-3 rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
      <p>{error}</p>
      {needsReload && <Button type="button" variant="outline" onClick={onReload}>Reload latest request</Button>}
    </div>}
    <div><label htmlFor="request-status" className="mb-2 block text-sm font-medium">New status</label>
      <select id="request-status" className={fieldClass} value={status} disabled={busy || needsReload} onChange={event => setStatus(event.target.value as RequestStatus)}>
        {["Requested", "Unavailable"].map(value => <option key={value}>{value}</option>)}
      </select></div>
    <div><label htmlFor="update-notes" className="mb-2 block text-sm font-medium">Update notes (optional)</label>
      <textarea id="update-notes" className={fieldClass} rows={3} maxLength={2000} value={notes} disabled={busy} onChange={event => setNotes(event.target.value)} aria-describedby="notes-help" />
      <p id="notes-help" className="mt-1 text-xs text-muted-foreground">Explain what is arranged or still outstanding. Up to 2000 characters.</p></div>
    <Button type="submit" disabled={busy || needsReload || status === request.status}>{busy ? "Saving…" : "Save status"}</Button>
  </form>;
}

function StatusHistory({ requestId }: { requestId: string }) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<{ history: RequestHistory[]; has_more: boolean } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ history: RequestHistory[]; has_more: boolean }>(`/equipment/requests/${requestId}/history?page=${page}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : "Could not load status history."); });
    return () => controller.abort();
  }, [requestId, page, retry]);
  function changePage(next: number) { setData(null); setError(""); setPage(next); }

  return <section aria-label="Status history" className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
    <h2 className="text-lg font-semibold">Status history</h2>
    {error ? <div role="alert" className="space-y-3 text-sm text-destructive"><p>{error}</p>
      <Button variant="outline" onClick={() => { setError(""); setRetry(value => value + 1); }}>Retry history</Button></div>
      : !data ? <p role="status" className="text-sm text-muted-foreground">Loading history…</p> : <>
        {data.history.length === 0 ? <p className="text-sm text-muted-foreground">No status updates on this page.</p> : <ol className="divide-y divide-border">
          {data.history.map(entry => <li key={entry.revision} className="space-y-2 py-4 first:pt-0">
            <p className="text-sm font-medium">{entry.from_status} → {entry.status}</p>
            <p className="text-xs text-muted-foreground">{entry.actor_name} · {equipmentTimestamp(entry.changed_at)} SGT</p>
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{entry.notes || "No update notes."}</p>
            {entry.reservation_snapshot && <div className="text-xs text-muted-foreground"><p>{equipmentTimestamp(entry.reservation_snapshot.start_at)} – {equipmentTimestamp(entry.reservation_snapshot.end_at)} SGT</p>
              {entry.reservation_snapshot.items.map((item, index) => <p key={index}>{item.equipment_type}: {item.quantity} reserved</p>)}</div>}
          </li>)}
        </ol>}
        <nav aria-label="History pages" className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" disabled={page === 1} onClick={() => changePage(page - 1)}>Previous updates</Button>
          <span className="order-first w-full whitespace-nowrap text-center text-sm text-muted-foreground sm:order-none sm:w-auto">Page {page}</span>
          <Button variant="outline" disabled={!data.has_more} onClick={() => changePage(page + 1)}>Older updates</Button>
        </nav>
      </>}
  </section>;
}

function RequestDetails({ requestId, role }: { requestId: string; role: string }) {
  const [request, setRequest] = useState<EquipmentRequest | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ request: EquipmentRequest }>(`/equipment/requests/${requestId}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setRequest(result.request); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : "Could not load the equipment request."); });
    return () => controller.abort();
  }, [requestId, retry]);
  function reload() { setRequest(null); setError(""); setMessage(""); setRetry(value => value + 1); }
  const closed = request && ["Cancelled", "Completed", "Rejected"].includes(request.event.status);

  return <div className="space-y-5">
    <Link href="/equipment/requests" className="text-sm font-medium text-primary hover:underline">Back to equipment requests</Link>
    {message && <p role="status" className="rounded-lg border border-border bg-muted p-4 text-sm">{message}</p>}
    {error ? <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-card p-5"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={reload}>Try again</Button></div>
      : !request ? <p role="status">Loading equipment request…</p> : <>
        <section aria-label="Request details" className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h2 className="break-words text-xl font-semibold">{request.event.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">Event: {equipmentTimestamp(request.event.event_datetime)} SGT · {request.event.status}</p></div>
            <Button variant="outline" onClick={reload}>Refresh request</Button>
          </div>
          <p className="text-sm">Current status: <strong>{request.status}</strong></p>
          {request.reported_status && <p className="text-sm text-muted-foreground">Previously recorded as {request.reported_status}. The current status reflects active bookings linked to this request.</p>}
          {request.reservation_start_at && request.reservation_end_at && <p className="text-sm text-muted-foreground">Reservation slot: {equipmentTimestamp(request.reservation_start_at)} – {equipmentTimestamp(request.reservation_end_at)} SGT</p>}
          {request.update_notes && <p className="whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-sm">{request.update_notes}</p>}
          <ul className="divide-y divide-border rounded-xl border border-border">
            {request.items.map(item => <li key={item.equipment_id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{item.equipment_type}</h3><p className="break-words text-xs text-muted-foreground">{item.location}</p></div><span className="shrink-0 text-sm font-semibold">Qty {item.quantity}</span></div>
              <p className="text-sm">Reserved {item.reserved_quantity ?? 0} · Remaining {Math.max(0, item.quantity - (item.reserved_quantity ?? 0))}</p>
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.technical_notes || "No technical notes."}</p>
            </li>)}
          </ul>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Requested by {request.requester.display_name} · {equipmentTimestamp(request.requested_at)} SGT</p>
            {request.updated_at && <p>Last status update: {equipmentTimestamp(request.updated_at)} SGT</p>}
            <p className="break-all">Request reference: {recordReference(request, request.requested_at)}</p>
          </div>
        </section>
        {role === "Tech Support" && !closed ? <>
          <ReservationForm key={`reservations-${request.revision}`} request={request} onReload={reload} onSaved={() => {
            reload(); setMessage("Reservations saved. Availability and request status now reflect the reserved quantities.");
          }} />
          {request.items.some(item => (item.reserved_quantity ?? 0) > 0)
            ? <p className="text-sm text-muted-foreground">Status is calculated from reserved quantities. Release all units before marking this request Unavailable.</p>
            : <StatusForm key={request.revision} request={request} onReload={reload} onSaved={saved => {
          setRequest(current => current ? { ...current, ...saved } : current);
          setMessage("Status updated. The Coordinator can see the new status and notes.");
        }} />}</> : <p className="text-sm text-muted-foreground">{closed ? "This event is closed. Its equipment request and history are read-only." : "Tech Support updates these arrangements. Refresh this page to see the latest status."}</p>}
        <StatusHistory key={`${request.revision}-${retry}`} requestId={request.id} />
      </>}
  </div>;
}

export default function EquipmentRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = use(params);
  return <EquipmentWorkspace title="Equipment request" description="Review the requested equipment, current arrangements and status history.">
    {role => <RequestDetails key={`${requestId}-${role}`} requestId={requestId} role={role} />}
  </EquipmentWorkspace>;
}
