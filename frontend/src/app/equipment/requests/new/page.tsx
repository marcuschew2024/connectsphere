"use client";

import { recordReference } from "@/lib/record-reference";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { equipmentTimestamp, type Equipment } from "@/lib/equipment";
import type { EquipmentRequest, RequestEvent } from "@/lib/equipment-requests";
import { Button } from "@/components/ui/button";
import EquipmentWorkspace from "../../equipment-workspace";

const INPUT = "mt-2 w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
type Line = { key: number; equipment_id: string; quantity: string; technical_notes: string };
type Submission = Pick<EquipmentRequest, "id" | "status" | "routed_to" | "requested_at">;
const blankLine = (key: number): Line => ({ key, equipment_id: "", quantity: "1", technical_notes: "" });

// Both option endpoints are paginated. A later catalogue page must remain selectable.
async function loadOptions(signal: AbortSignal) {
  const events: RequestEvent[] = [];
  const equipment: Equipment[] = [];
  await Promise.all([
    (async () => {
      for (let page = 1; ; page++) {
        const result = await apiRequest<{ events: RequestEvent[]; has_more: boolean }>(`/equipment/requests/events?page=${page}`, { signal });
        events.push(...result.events);
        if (!result.has_more) break;
      }
    })(),
    (async () => {
      for (let page = 1; ; page++) {
        const result = await apiRequest<{ equipment: Equipment[]; has_more: boolean }>(`/equipment?page=${page}`, { signal });
        equipment.push(...result.equipment);
        if (!result.has_more) break;
      }
    })(),
  ]);
  return { events, equipment };
}

function RequestForm() {
  const [options, setOptions] = useState<Awaited<ReturnType<typeof loadOptions>> | null>(null);
  const [retry, setRetry] = useState(0);
  const [eventId, setEventId] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine(1)]);
  const nextKey = useRef(2);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Submission | null>(null);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const alert = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadOptions(controller.signal)
      .then(result => { if (!controller.signal.aborted) setOptions(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof ApiError ? cause.message : "Could not load request options."); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);

  function updateLine(key: number, patch: Partial<Line>) {
    setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setFields({});
    try {
      const result = await apiRequest<{ request: Submission }>("/equipment/requests", {
        method: "POST",
        body: JSON.stringify({ event_id: eventId, items: lines.map(line => ({
          equipment_id: line.equipment_id,
          quantity: line.quantity.trim() === "" ? null : Number(line.quantity),
          technical_notes: line.technical_notes,
        })) }),
      });
      setSaved(result.request);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not confirm submission. Check requests before retrying.");
      if (cause instanceof ApiError) setFields(cause.fields);
    } finally { setBusy(false); }
  }

  function fieldError(name: string) {
    return fields[name] ? <p id={`error-${name}`} className="mt-1 text-xs text-destructive">{fields[name]}</p> : null;
  }
  function accessibility(name: string) {
    return { "aria-invalid": !!fields[name], "aria-describedby": fields[name] ? `error-${name}` : undefined };
  }

  if (saved) return <section role="status" className="space-y-4 rounded-2xl border border-border bg-card p-6">
    <h2 className="text-xl font-semibold">Equipment request submitted</h2>
    <p className="text-sm">Status: <strong>{saved.status}</strong> · Routed to {saved.routed_to}</p>
    <p className="text-sm text-muted-foreground">Recorded {equipmentTimestamp(saved.requested_at)} SGT. Tech Support can now review every item and note.</p>
    <p className="break-all text-xs text-muted-foreground">Request reference: {recordReference(saved, saved.requested_at)}</p>
    <Link href="/equipment/requests" className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">View requests</Link>
  </section>;

  return <div className="max-w-3xl space-y-4">
    {error && <div ref={alert} role="alert" tabIndex={-1} className="space-y-3 rounded-xl border border-destructive/30 bg-card p-4 text-sm text-destructive">
      <p>{error}</p>
      {!options && <Button variant="outline" onClick={() => { setError(""); setRetry(value => value + 1); }}>Try again</Button>}
      {options && <Link className="inline-block underline" href="/equipment/requests">Check requests</Link>}
    </div>}
    {!options ? !error && <p role="status">Loading your events and catalogue…</p> : !options.events.length || !options.equipment.length ?
      <p role="status" className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        {!options.events.length ? "No assigned events are in Planning. Approve an event before requesting equipment." : "The equipment catalogue is empty. Tech Support needs to add equipment first."}
      </p> : <form noValidate onSubmit={submit} className="space-y-6 rounded-2xl border border-border bg-card p-5 sm:p-7">
        <fieldset disabled={busy} className="min-w-0 space-y-6">
          <legend className="sr-only">Equipment request details</legend>
          <div>
            <label htmlFor="request-event" className="text-sm font-medium">Event</label>
            <select id="request-event" value={eventId} onChange={event => setEventId(event.target.value)} className={INPUT} {...accessibility("event_id")}>
              <option value="">Choose your Planning event</option>
              {options.events.map(event => <option key={event.id} value={event.id}>{event.title} · {equipmentTimestamp(event.event_datetime)} SGT</option>)}
            </select>
            {fieldError("event_id")}
          </div>
          <div className="space-y-4">
            <div><h2 className="text-lg font-semibold">Equipment and requirements</h2><p className="mt-1 text-sm text-muted-foreground">Enter the quantities you need. Tech Support will review availability separately.</p></div>
            {lines.map((line, index) => <fieldset key={line.key} className="min-w-0 space-y-4 rounded-xl border border-border p-4">
              <legend className="px-2 text-sm font-semibold">Item {index + 1}</legend>
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <div>
                  <label htmlFor={`equipment-${line.key}`} className="text-sm font-medium">Equipment {index + 1}</label>
                  <select id={`equipment-${line.key}`} value={line.equipment_id} onChange={event => updateLine(line.key, { equipment_id: event.target.value })} className={INPUT} {...accessibility(`items.${index}.equipment_id`)}>
                    <option value="">Choose equipment</option>
                    {options.equipment.map(item => <option key={item.id} value={item.id}>{item.equipment_type} · {item.location} · {item.operational_status}</option>)}
                  </select>
                  {fieldError(`items.${index}.equipment_id`)}
                </div>
                <div>
                  <label htmlFor={`quantity-${line.key}`} className="text-sm font-medium">Quantity {index + 1}</label>
                  <input id={`quantity-${line.key}`} type="number" min="1" max="2147483647" step="1" value={line.quantity} onChange={event => updateLine(line.key, { quantity: event.target.value })} className={INPUT} {...accessibility(`items.${index}.quantity`)} />
                  {fieldError(`items.${index}.quantity`)}
                </div>
              </div>
              <div>
                <label htmlFor={`notes-${line.key}`} className="text-sm font-medium">Technical notes {index + 1} <span className="font-normal text-muted-foreground">(optional)</span></label>
                <textarea id={`notes-${line.key}`} rows={3} maxLength={2000} value={line.technical_notes} onChange={event => updateLine(line.key, { technical_notes: event.target.value })} placeholder="Connections, setup or technical requirements" className={INPUT} {...accessibility(`items.${index}.technical_notes`)} />
                {fieldError(`items.${index}.technical_notes`)}
              </div>
              {lines.length > 1 && <Button type="button" variant="outline" onClick={() => { setLines(current => current.filter(item => item.key !== line.key)); setFields({}); }}>Remove item {index + 1}</Button>}
            </fieldset>)}
            <Button type="button" variant="outline" disabled={lines.length >= 50} onClick={() => setLines(current => [...current, blankLine(nextKey.current++)])}>Add another item</Button>
          </div>
          <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">This request will be sent to Tech Support as <strong className="text-foreground">Requested</strong>. Your identity and submission time are recorded automatically.</p>
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit">{busy ? "Submitting…" : "Submit equipment request"}</Button>
            <Link href="/equipment/requests" className="text-sm underline">Cancel</Link>
          </div>
        </fieldset>
      </form>}
  </div>;
}

export default function NewEquipmentRequestPage() {
  return <EquipmentWorkspace requesting title="Request equipment" description="Tell Tech Support what your event needs. Choose items from the shared catalogue and add setup details.">
    {role => <RequestForm key={role} />}
  </EquipmentWorkspace>;
}
