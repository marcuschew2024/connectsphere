"use client";

import { useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventRecord } from "@/lib/events";

const TEXT_FIELDS = [
  { name: "title", label: "Event name", limit: 200, multiline: false },
  { name: "description", label: "Description", limit: 5000, multiline: true },
  { name: "purpose", label: "Purpose", limit: 2000, multiline: true },
  { name: "category", label: "Category", limit: 100, multiline: false },
] as const;
const REQUIREMENT_FIELDS = [
  { name: "venue_requirements", label: "Venue requirements" },
  { name: "accessibility_requirements", label: "Accessibility requirements" },
  { name: "equipment_requirements", label: "Equipment requirements" },
  { name: "registration_requirements", label: "Registration requirements" },
] as const;
const INPUT_STYLE =
  "w-full rounded border border-slate-600 bg-slate-950 p-3 [color-scheme:dark] focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400";

// Convert a stored UTC ISO time to the value a datetime-local input expects (local time).
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
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
      <section className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400 sm:p-8">
        <h2 className="text-lg font-semibold text-slate-100">Editing</h2>
        <p>
          Direct editing is only available while an event is in Planning. This event is{" "}
          <span className="font-medium text-slate-200">{event.status}</span> — changes must go
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
      setFieldErrors({ expected_attendance: "Enter a whole number greater than zero." });
      return;
    }
    const form = new FormData(formEvent.currentTarget);
    const localTime = String(form.get("event_datetime") ?? "");
    const date = localTime ? new Date(localTime) : null;
    if (date && Number.isNaN(date.getTime())) {
      setFieldErrors({ event_datetime: "Choose a valid date and time." });
      return;
    }
    const attendance = String(form.get("expected_attendance") ?? "");
    const details = Object.fromEntries(form.entries());
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
          // Convert the user's local time to an explicit UTC time for Flask.
          event_datetime: date ? date.toISOString() : null,
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
      <p id={`${name}-error`} className="mt-1 text-sm text-red-300">{fieldErrors[name]}</p>
    ) : null;
  }

  return (
    <form onSubmit={saveEdit} noValidate className="space-y-6 rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-8">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Edit event details</h2>
        <p className="text-sm text-slate-400">Available while the event is in Planning. Each edit is recorded with your name and the time.</p>
      </div>
      {notice && <p role="status" className="rounded border border-green-700 bg-green-950/30 p-3 text-sm text-green-200">{notice}</p>}
      {error && <p role="alert" className="rounded border border-red-700 bg-red-950/40 p-3 text-red-200">{error}</p>}
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
            <label htmlFor="edit-event_datetime" className="mb-2 block font-medium">Date and time *</label>
            <input id="edit-event_datetime" name="event_datetime" type="datetime-local"
              defaultValue={toLocalInput(event.event_datetime)}
              aria-invalid={!!fieldErrors.event_datetime}
              aria-describedby={fieldErrors.event_datetime ? "edit-time-help event_datetime-error" : "edit-time-help"}
              className={INPUT_STYLE} />
            <p id="edit-time-help" className="mt-1 text-sm text-slate-400">Uses your device&apos;s time zone.</p>
            {fieldError("event_datetime")}
          </div>
          <div>
            <label htmlFor="edit-expected_attendance" className="mb-2 block font-medium">Expected attendance *</label>
            <input id="edit-expected_attendance" name="expected_attendance" type="number" min="1" step="1" max="2147483647"
              defaultValue={event.expected_attendance ?? ""} aria-invalid={!!fieldErrors.expected_attendance}
              aria-describedby={fieldErrors.expected_attendance ? "expected_attendance-error" : undefined}
              className={INPUT_STYLE} />
            {fieldError("expected_attendance")}
          </div>
        </div>
        <fieldset className="space-y-5 border-t border-slate-700 pt-4">
          <legend className="px-2 font-semibold">Additional requirements (optional)</legend>
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
        <button type="submit" className="rounded bg-sky-300 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">
          {busy ? "Saving…" : "Save changes"}
        </button>
      </fieldset>
    </form>
  );
}
