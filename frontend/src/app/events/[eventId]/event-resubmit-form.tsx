"use client";

import { useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventClarification, EventRecord } from "@/lib/events";

const TEXT_FIELDS = [
  ["title", "Event name"], ["description", "Description"], ["purpose", "Purpose"], ["category", "Category"],
] as const;
const REQUIREMENT_FIELDS = [
  ["venue_requirements", "Venue requirements"],
  ["accessibility_requirements", "Accessibility requirements"],
  ["equipment_requirements", "Equipment requirements"],
  ["registration_requirements", "Registration requirements"],
] as const;
const INPUT_STYLE = "w-full rounded border border-slate-600 bg-slate-950 p-3 [color-scheme:dark]";

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return Number.isNaN(date.getTime()) ? "" : local.toISOString().slice(0, 16);
}

export default function EventResubmitForm({
  event,
  clarification,
  onSaved,
}: {
  event: EventRecord;
  clarification: EventClarification;
  onSaved: (event: EventRecord) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function resubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setFieldErrors({});
    const form = new FormData(formEvent.currentTarget);
    const dateValue = String(form.get("event_datetime") ?? "");
    const date = dateValue ? new Date(dateValue) : null;
    const attendance = String(form.get("expected_attendance") ?? "");
    const details = Object.fromEntries(form.entries());
    try {
      const result = await apiRequest<{ event: EventRecord }>(`/events/${event.id}/resubmit`, {
        method: "POST",
        body: JSON.stringify({
          ...details,
          event_datetime: date ? date.toISOString() : null,
          expected_attendance: attendance === "" ? null : Number(attendance),
        }),
      });
      onSaved(result.event);
    } catch (requestError) {
      if (requestError instanceof ApiError) {
        setError(requestError.message);
        setFieldErrors(requestError.fields);
      } else {
        setError("Could not resubmit the revised request.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={resubmit} noValidate className="space-y-5 rounded-2xl border border-amber-500/30 bg-slate-900/70 p-6 sm:p-8">
      <div>
        <h2 className="text-lg font-semibold">Changes requested</h2>
        <p className="mt-1 text-sm text-amber-200">{clarification.note}</p>
        <p className="mt-2 text-sm text-slate-400">Update the details below and resubmit for Coordinator review.</p>
      </div>
      {error && <p role="alert" className="rounded border border-red-700 p-3 text-red-200">{error}</p>}
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-40">
        {TEXT_FIELDS.map(([name, label]) => (
          <div key={name}>
            <label htmlFor={`resubmit-${name}`} className="mb-2 block font-medium">{label} *</label>
            {name === "title" || name === "category" ? (
              <input id={`resubmit-${name}`} name={name} defaultValue={event[name] ?? ""} maxLength={name === "title" ? 200 : 100} className={INPUT_STYLE} />
            ) : (
              <textarea id={`resubmit-${name}`} name={name} defaultValue={event[name] ?? ""} rows={3} maxLength={name === "description" ? 5000 : 2000} className={INPUT_STYLE} />
            )}
            {fieldErrors[name] && <p className="mt-1 text-sm text-red-300">{fieldErrors[name]}</p>}
          </div>
        ))}
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="font-medium">Date and time *<input name="event_datetime" type="datetime-local" defaultValue={toLocalInput(event.event_datetime)} className={`${INPUT_STYLE} mt-2`} /></label>
          <label className="font-medium">Expected attendance *<input name="expected_attendance" type="number" min="1" step="1" defaultValue={event.expected_attendance ?? ""} className={`${INPUT_STYLE} mt-2`} /></label>
        </div>
        {REQUIREMENT_FIELDS.map(([name, label]) => (
          <label key={name} className="block font-medium">{label}<textarea name={name} defaultValue={event[name] ?? ""} rows={2} maxLength={2000} className={`${INPUT_STYLE} mt-2`} /></label>
        ))}
        <button type="submit" className="rounded bg-sky-300 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? "Resubmitting..." : "Revise and resubmit"}</button>
      </fieldset>
    </form>
  );
}
