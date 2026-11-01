"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { equipmentTimestamp } from "@/lib/equipment";
import type { EquipmentRequest } from "@/lib/equipment-requests";
import { Button } from "@/components/ui/button";

const fieldClass = "mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
// Inputs explicitly use Singapore time, even when the browser uses another zone.
function singaporeInput(value: string | null | undefined): string {
  return value ? new Date(new Date(value).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : "";
}

export default function ReservationForm({ request, onSaved, onReload }: {
  request: EquipmentRequest; onSaved: () => void; onReload: () => void;
}) {
  const [start, setStart] = useState(singaporeInput(request.reservation_start_at || request.event.event_datetime));
  const [end, setEnd] = useState(singaporeInput(request.reservation_end_at || request.event.event_end_datetime));
  const [quantities, setQuantities] = useState(request.items.map(item => String(item.reserved_quantity ?? 0)));
  const [bookings, setBookings] = useState(request.items.map(() => ""));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);

  function chooseBooking(index: number, id: string) {
    setBookings(current => current.map((value, i) => i === index ? id : value));
    const booking = request.existing_reservations?.find(row => row.id === id);
    if (booking) {
      setQuantities(current => current.map((value, i) => i === index ? String(booking.quantity) : value));
      setStart(singaporeInput(booking.start_at)); setEnd(singaporeInput(booking.end_at));
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || needsReload) return;
    if (end <= start) { setError("Choose an end time after the start time."); return; }
    setBusy(true); setError("");
    try {
      await apiRequest(`/equipment/requests/${request.id}/reservations`, {
        method: "PUT", body: JSON.stringify({
          start_at: new Date(`${start}+08:00`).toISOString(), end_at: new Date(`${end}+08:00`).toISOString(),
          revision: request.revision, notes,
          items: request.items.map((item, index) => ({ equipment_id: item.equipment_id,
            quantity: Number(quantities[index]), ...(bookings[index] ? { reservation_id: bookings[index] } : {}) })),
        }),
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not confirm the save. Reload the request before retrying.");
      setNeedsReload(!(cause instanceof ApiError) || cause.status === 409 || cause.status >= 500);
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} aria-label="Reserve requested equipment" className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
    <div><h2 className="text-lg font-semibold">Reserve requested equipment</h2>
      <p className="mt-1 text-sm text-muted-foreground">Enter the total units to reserve for this time slot. Saving sets Reserved or Partially fulfilled automatically. Lowering a quantity releases units; zero releases that item.</p></div>
    {error && <div ref={alert} tabIndex={-1} role="alert" className="space-y-3 rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
      <p>{error}</p>{needsReload && <Button type="button" variant="outline" onClick={onReload}>Reload latest request</Button>}
    </div>}
    <fieldset disabled={busy || needsReload} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Reservation start (SGT)<input className={fieldClass} type="datetime-local" required value={start} onChange={event => setStart(event.target.value)} /></label>
        <label className="block text-sm font-medium">Reservation end (SGT)<input className={fieldClass} type="datetime-local" required value={end} onChange={event => setEnd(event.target.value)} /></label>
      </div>
      {request.items.map((item, index) => {
        const linked = request.reservations?.some(row => row.equipment_id === item.equipment_id);
        const existing = linked ? [] : (request.existing_reservations ?? []).filter(row => row.equipment_id === item.equipment_id && row.quantity <= item.quantity);
        return <div key={item.equipment_id} className="space-y-3 rounded-xl border border-border p-4">
          <label className="block text-sm font-medium">Reserved quantity — {item.equipment_type}
            <input className={fieldClass} type="number" min={0} max={item.quantity} step={1} required value={quantities[index]}
              onChange={event => setQuantities(current => current.map((value, i) => i === index ? event.target.value : value))} /></label>
          <p className="text-xs text-muted-foreground">Requested {item.quantity} · Currently reserved {item.reserved_quantity ?? 0}</p>
          {existing.length > 0 && <><label className="block text-sm font-medium">Existing booking — {item.equipment_type}
            <select className={fieldClass} value={bookings[index]} onChange={event => chooseBooking(index, event.target.value)}>
              <option value="">Create reservation for this request</option>
              {existing.map(row => <option key={row.id} value={row.id}>{row.quantity} unit(s) · {equipmentTimestamp(row.start_at)} – {equipmentTimestamp(row.end_at)} SGT</option>)}
            </select></label><p className="text-xs text-muted-foreground">Already reserved through the catalogue? Link the matching booking to count it once. Keep its quantity and time slot unchanged while linking.</p></>}
        </div>;
      })}
      <label className="block text-sm font-medium">Reservation notes (optional)<textarea className={fieldClass} rows={3} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      <Button type="submit">{busy ? "Saving…" : "Save reservations"}</Button>
    </fieldset>
  </form>;
}
