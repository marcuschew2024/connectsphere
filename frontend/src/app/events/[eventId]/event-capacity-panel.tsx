"use client";

import { useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventRecord } from "@/lib/events";

type CapacitySummary = {
  capacity: number | null;
  registered_count: number;
  remaining: number;
  is_full: boolean;
};

export default function EventCapacityPanel({ event, actingRole, onSaved }: {
  event: EventRecord;
  actingRole: string | null;
  onSaved: (updated: EventRecord) => void;
}) {
  const [value, setValue] = useState(String(event.registration_capacity ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canEdit = actingRole === "Organiser" && ["Draft", "Submitted", "Planning"].includes(event.status);
  const capacity = event.registration_capacity ?? null;
  const registered = event.registered_count ?? 0;
  const remaining = capacity === null ? 0 : Math.max(0, capacity - registered);
  const full = capacity !== null && remaining === 0;

  async function saveCapacity(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (busy) return;
    setNotice("");
    const input = formEvent.currentTarget.elements.namedItem("capacity") as HTMLInputElement;
    const next = Number(value);
    if (input.validity.badInput || value.trim() === "" || !Number.isInteger(next) || next < 1 || next > 10000) {
      setError("Enter a whole number between 1 and 10,000.");
      input.focus();
      return;
    }
    setError("");
    setBusy(true);
    try {
      const result = await apiRequest<{ registration_capacity: CapacitySummary }>(
        `/events/${event.id}/registration-capacity`, {
          method: "PUT", body: JSON.stringify({ capacity: next }),
        },
      );
      onSaved({ ...event, registration_capacity: result.registration_capacity.capacity,
        registered_count: result.registration_capacity.registered_count });
      setNotice("Capacity saved. Further signups will be blocked when all places are taken.");
    } catch (saveError) {
      setError(saveError instanceof ApiError
        ? saveError.fields.capacity || saveError.message
        : "Could not confirm the capacity change. Refresh the event before retrying.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="registration-capacity-heading" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="registration-capacity-heading" className="font-semibold">Registration capacity</h2>
          <p className="mt-1 text-sm text-muted-foreground">The maximum number of attendees who can sign up for this event.</p>
        </div>
        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium">
          {capacity === null ? "Not set" : full ? "Full" : `${remaining.toLocaleString()} ${remaining === 1 ? "place" : "places"} remaining`}
        </span>
      </div>
      {capacity !== null && <p className="mt-4 text-sm"><strong>{registered.toLocaleString()}</strong> registered of {capacity.toLocaleString()} places</p>}
      {capacity === null && <p className="mt-4 text-sm text-muted-foreground">Registration stays closed until a capacity is set.</p>}
      {full && <p className="mt-2 text-sm text-muted-foreground">This event is full. No places are currently available.</p>}
      {canEdit ? (
        <form onSubmit={saveCapacity} noValidate className="mt-5 space-y-3 border-t border-border pt-4">
          <label htmlFor="registration-capacity" className="block text-sm font-medium">Maximum attendees</label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <input id="registration-capacity" name="capacity" type="number" min="1" max="10000" step="1"
              value={value} onChange={(change) => { setValue(change.target.value); setError(""); setNotice(""); }}
              disabled={busy} aria-required="true" aria-invalid={!!error}
              aria-describedby={`capacity-help${error ? " capacity-error" : ""}`}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:max-w-48" />
            <button type="submit" disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {busy ? "Saving…" : "Save capacity"}
            </button>
          </div>
          <p id="capacity-help" className="text-sm text-muted-foreground">Set this before confirmation. Expected attendance is a planning estimate and does not set this limit.</p>
          {error && <p id="capacity-error" role="alert" className="text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
        </form>
      ) : actingRole === "Organiser" && !["Completed", "Cancelled", "Rejected"].includes(event.status)
        ? <p className="mt-4 text-sm text-muted-foreground">Capacity is locked after confirmation. Request a change through your coordinator.</p>
        : null}
    </section>
  );
}
