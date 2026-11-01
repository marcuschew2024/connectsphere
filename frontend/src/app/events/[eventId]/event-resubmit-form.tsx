"use client";

import { useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventClarification, EventRecord } from "@/lib/events";
import EventVenueOptions from "@/components/event-venue-options";

const TEXT_FIELDS = [
  ["title", "Event name"], ["description", "Description"], ["purpose", "Purpose"], ["category", "Category"],
] as const;
const REQUIREMENT_FIELDS = [
  ["equipment_requirements", "Equipment requirements"],
  ["registration_requirements", "Registration requirements"],
] as const;
const INPUT_STYLE = "w-full rounded-md border border-input bg-background p-3 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30";

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return Number.isNaN(date.getTime()) ? "" : local.toISOString().slice(0, 16);
}
// The event is same-day, so split the stored start/end into date + time inputs.
function localDatePart(value: string | null) {
  return toLocalInput(value).slice(0, 10);
}
function localTimePart(value: string | null) {
  return toLocalInput(value).slice(11, 16);
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
    const eventDate = String(form.get("event_date") ?? "");
    const startValue = String(form.get("event_start_time") ?? "");
    const endValue = String(form.get("event_end_time") ?? "");
    const start = eventDate && startValue ? new Date(`${eventDate}T${startValue}`) : null;
    const end = eventDate && endValue ? new Date(`${eventDate}T${endValue}`) : null;
    const timeErrors: Record<string, string> = {};
    if (start && Number.isNaN(start.getTime())) timeErrors.event_datetime = "Choose a valid date and time.";
    if (end && Number.isNaN(end.getTime())) timeErrors.event_end_datetime = "Choose a valid end time.";
    if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
      timeErrors.event_end_datetime = "Choose an end time after the start time.";
    }
    if (Object.keys(timeErrors).length > 0) {
      setFieldErrors(timeErrors);
      setBusy(false);
      return;
    }
    const attendance = String(form.get("expected_attendance") ?? "");
    const details = Object.fromEntries(form.entries());
    delete details.event_date;
    delete details.event_start_time;
    delete details.event_end_time;
    try {
      const result = await apiRequest<{ event: EventRecord }>(`/events/${event.id}/resubmit`, {
        method: "POST",
        body: JSON.stringify({
          ...details,
          event_datetime: start && !Number.isNaN(start.getTime()) ? start.toISOString() : null,
          event_end_datetime: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
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
    <form onSubmit={resubmit} noValidate className="space-y-5 rounded-2xl border border-amber-500/40 bg-card p-6 shadow-sm sm:p-8">
      <div>
        <h2 className="text-lg font-semibold">Changes requested</h2>
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{clarification.note}</p>
        <p className="mt-2 text-sm text-muted-foreground">Update the details below and resubmit for Coordinator review.</p>
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-40">
        {TEXT_FIELDS.map(([name, label]) => (
          <div key={name}>
            <label htmlFor={`resubmit-${name}`} className="mb-2 block font-medium">{label} *</label>
            {name === "title" || name === "category" ? (
              <input id={`resubmit-${name}`} name={name} defaultValue={event[name] ?? ""} maxLength={name === "title" ? 200 : 100} className={INPUT_STYLE} />
            ) : (
              <textarea id={`resubmit-${name}`} name={name} defaultValue={event[name] ?? ""} rows={3} maxLength={name === "description" ? 5000 : 2000} className={INPUT_STYLE} />
            )}
            {fieldErrors[name] && <p className="mt-1 text-sm text-destructive">{fieldErrors[name]}</p>}
          </div>
        ))}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="font-medium" htmlFor="resubmit-event_date">Date *</label>
            <input id="resubmit-event_date" name="event_date" type="date" defaultValue={localDatePart(event.event_datetime)} className={`${INPUT_STYLE} mt-2`} />
            {fieldErrors.event_datetime && <p className="mt-1 text-sm text-destructive">{fieldErrors.event_datetime}</p>}
          </div>
          <label className="font-medium">Expected attendance *<input name="expected_attendance" type="number" min="1" step="1" defaultValue={event.expected_attendance ?? ""} className={`${INPUT_STYLE} mt-2`} /></label>
          <div>
            <label className="font-medium" htmlFor="resubmit-event_start_time">Start time *</label>
            <input id="resubmit-event_start_time" name="event_start_time" type="time" defaultValue={localTimePart(event.event_datetime)} className={`${INPUT_STYLE} mt-2`} />
          </div>
          <div>
            <label className="font-medium" htmlFor="resubmit-event_end_time">End time *</label>
            <input id="resubmit-event_end_time" name="event_end_time" type="time" defaultValue={localTimePart(event.event_end_datetime)} className={`${INPUT_STYLE} mt-2`} />
            {fieldErrors.event_end_datetime && <p className="mt-1 text-sm text-destructive">{fieldErrors.event_end_datetime}</p>}
          </div>
        </div>
        <EventVenueOptions venueRequirements={event.venue_requirements} facilityRequirements={event.facility_requirements} accessibilityRequirements={event.accessibility_requirements} />
        {REQUIREMENT_FIELDS.map(([name, label]) => (
          <label key={name} className="block font-medium">{label}<textarea name={name} defaultValue={event[name] ?? ""} rows={2} maxLength={2000} className={`${INPUT_STYLE} mt-2`} /></label>
        ))}
        <button type="submit" className="rounded-md bg-primary px-5 py-3 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{busy ? "Resubmitting..." : "Revise and resubmit"}</button>
      </fieldset>
    </form>
  );
}
