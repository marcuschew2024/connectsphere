"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventRecord } from "@/lib/events";
import EventVenueOptions from "@/components/event-venue-options";

const TEXT_FIELDS = [
  { name: "title", label: "Event name", limit: 200, multiline: false },
  { name: "description", label: "Description", limit: 5000, multiline: true },
  { name: "purpose", label: "Purpose", limit: 2000, multiline: true },
  { name: "category", label: "Category", limit: 100, multiline: false },
] as const;
const REQUIREMENT_FIELDS = [
  { name: "equipment_requirements", label: "Equipment requirements" },
  { name: "registration_requirements", label: "Registration requirements" },
] as const;
const INPUT_STYLE =
  "w-full rounded-md border border-input bg-background p-3 text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30";

// Convert a stored UTC ISO time to the value a datetime-local input expects (local time).
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
// The event is same-day, so split the stored start/end into date + time inputs.
function localDatePart(iso: string | null): string {
  return toLocalInput(iso).slice(0, 10);
}
function localTimePart(iso: string | null): string {
  return toLocalInput(iso).slice(11, 16);
}

export default function EventEditForm({
  event,
  onSaved,
}: {
  event: EventRecord;
  onSaved: (updated: EventRecord) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");

  // Direct editing is only available while the event is in Planning (SCRUM-23 / TC-US4.6-03).
  if (event.status !== "Planning") {
    return (
      <section className="space-y-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold text-foreground">Editing</h2>
        <p>
          Direct editing is only available while an event is in Planning. This event is{" "}
          <span className="font-medium text-foreground">{event.status}</span> — changes must go
          through a change request.
        </p>
      </section>
    );
  }

  async function saveEdit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (busy) return;
    setError("");
    setFieldErrors({});
    setNotice("");

    const attendanceInput = formEvent.currentTarget.elements.namedItem(
      "expected_attendance",
    ) as HTMLInputElement;
    if (attendanceInput.validity.badInput) {
      setFieldErrors({ expected_attendance: "Enter a whole number between 1 and 10,000." });
      return;
    }
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
      return;
    }
    const attendance = String(form.get("expected_attendance") ?? "");
    const details = Object.fromEntries(form.entries());
    delete details.event_date;
    delete details.event_start_time;
    delete details.event_end_time;
    setBusy(true);
    try {
      const result = await apiRequest<{
        event: EventRecord;
        importance: string;
        changed_fields: string[];
      }>(`/events/${event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...details,
          // Convert the user's local times to explicit UTC times for Flask.
          event_datetime: start && !Number.isNaN(start.getTime()) ? start.toISOString() : null,
          event_end_datetime: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
          expected_attendance: attendance === "" ? null : Number(attendance),
        }),
      });
      onSaved(result.event);
      setNotice(
        result.changed_fields.length === 0
          ? "No changes to save."
          : result.importance === "important"
            ? "Saved. Recorded as an important change (affects confirmed arrangements)."
            : "Saved. Recorded as an ordinary change.",
      );
    } catch (saveError) {
      if (saveError instanceof ApiError) {
        setFieldErrors(saveError.fields);
        setError(saveError.message);
      } else {
        setError("Could not save the changes. Check your connection and contact the team.");
      }
    } finally {
      setBusy(false);
    }
  }

  function fieldError(name: string) {
    return fieldErrors[name] ? (
      <p id={`${name}-error`} className="mt-1 text-sm text-destructive">{fieldErrors[name]}</p>
    ) : null;
  }

  return (
    <form onSubmit={saveEdit} noValidate className="space-y-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Edit event details</h2>
        <p className="text-sm text-muted-foreground">Available while the event is in Planning. Each edit is recorded with your name and the time.</p>
      </div>
      {notice && <p role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-40">
        <legend className="sr-only">Event details</legend>
        {TEXT_FIELDS.map((field) => (
          <div key={field.name}>
            <label htmlFor={`edit-${field.name}`} className="mb-2 block font-medium">{field.label} *</label>
            {field.multiline ? (
              <textarea id={`edit-${field.name}`} name={field.name} rows={3} maxLength={field.limit}
                defaultValue={event[field.name] ?? ""} aria-invalid={!!fieldErrors[field.name]}
                aria-describedby={fieldErrors[field.name] ? `${field.name}-error` : undefined}
                className={INPUT_STYLE} />
            ) : (
              <input id={`edit-${field.name}`} name={field.name} type="text" maxLength={field.limit}
                defaultValue={event[field.name] ?? ""} aria-invalid={!!fieldErrors[field.name]}
                aria-describedby={fieldErrors[field.name] ? `${field.name}-error` : undefined}
                className={INPUT_STYLE} />
            )}
            {fieldError(field.name)}
          </div>
        ))}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-event_date" className="mb-2 block font-medium">Date *</label>
            <input id="edit-event_date" name="event_date" type="date"
              defaultValue={localDatePart(event.event_datetime)}
              aria-invalid={!!fieldErrors.event_datetime}
              aria-describedby={fieldErrors.event_datetime ? "edit-time-help event_datetime-error" : "edit-time-help"}
              className={INPUT_STYLE} />
            <p id="edit-time-help" className="mt-1 text-sm text-muted-foreground">Uses your device&apos;s time zone. The event starts and ends on this day.</p>
            {fieldError("event_datetime")}
          </div>
          <div>
            <label htmlFor="edit-expected_attendance" className="mb-2 block font-medium">Expected attendance *</label>
            <input id="edit-expected_attendance" name="expected_attendance" type="number" min="1" step="1" max="10000"
              defaultValue={event.expected_attendance ?? ""} aria-invalid={!!fieldErrors.expected_attendance}
              aria-describedby={fieldErrors.expected_attendance ? "expected_attendance-error" : undefined}
              className={INPUT_STYLE} />
            {fieldError("expected_attendance")}
          </div>
          <div>
            <label htmlFor="edit-event_start_time" className="mb-2 block font-medium">Start time *</label>
            <input id="edit-event_start_time" name="event_start_time" type="time"
              defaultValue={localTimePart(event.event_datetime)}
              aria-invalid={!!fieldErrors.event_datetime}
              className={INPUT_STYLE} />
          </div>
          <div>
            <label htmlFor="edit-event_end_time" className="mb-2 block font-medium">End time *</label>
            <input id="edit-event_end_time" name="event_end_time" type="time"
              defaultValue={localTimePart(event.event_end_datetime)}
              aria-invalid={!!fieldErrors.event_end_datetime}
              aria-describedby={fieldErrors.event_end_datetime ? "event_end_datetime-error" : undefined}
              className={INPUT_STYLE} />
            {fieldError("event_end_datetime")}
          </div>
        </div>
        <fieldset className="space-y-5 border-t border-border pt-4">
          <legend className="px-2 font-semibold">Additional requirements (optional)</legend>
          <EventVenueOptions venueRequirements={event.venue_requirements} facilityRequirements={event.facility_requirements} accessibilityRequirements={event.accessibility_requirements} />
          {REQUIREMENT_FIELDS.map((field) => (
            <div key={field.name}>
              <label htmlFor={`edit-${field.name}`} className="mb-2 block font-medium">{field.label}</label>
              <textarea id={`edit-${field.name}`} name={field.name} rows={2} maxLength={2000}
                defaultValue={event[field.name] ?? ""} aria-invalid={!!fieldErrors[field.name]}
                aria-describedby={fieldErrors[field.name] ? `${field.name}-error` : undefined}
                className={INPUT_STYLE} />
              {fieldError(field.name)}
            </div>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="rounded-md bg-primary px-5 py-3 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {busy ? "Saving…" : "Save changes"}
          </button>
          <Link
            href="/events/review"
            className="rounded-md border border-border px-5 py-3 font-semibold text-foreground hover:bg-muted"
          >
            Cancel
          </Link>
        </div>
      </fieldset>
    </form>
  );
}
