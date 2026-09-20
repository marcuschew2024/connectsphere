"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import type { EventRecord } from "@/lib/events";

// A small list keeps labels, limits and repeated form markup together.
const TEXT_FIELDS = [
  { name: "title", label: "Event name", limit: 200, required: true, multiline: false },
  { name: "description", label: "Description", limit: 5000, required: true, multiline: true },
  { name: "purpose", label: "Purpose", limit: 2000, required: true, multiline: true },
  { name: "category", label: "Category", limit: 100, required: true, multiline: false },
];
const REQUIREMENT_FIELDS = [
  { name: "venue_requirements", label: "Venue requirements" },
  { name: "accessibility_requirements", label: "Accessibility requirements" },
  { name: "equipment_requirements", label: "Equipment requirements" },
  { name: "registration_requirements", label: "Registration requirements" },
];
const INPUT_STYLE = "w-full rounded border border-slate-600 bg-slate-950 p-3 [color-scheme:dark] focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400";

function localDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function EventRequestForm({ canCreate, initialEvent }: {
  canCreate: boolean;
  initialEvent?: EventRecord;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<EventRecord | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const editing = !!initialEvent;

  async function saveRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canCreate) return;
    const formElement = event.currentTarget;
    setError("");
    setFieldErrors({});
    setLastSaved(null);

    const attendanceInput = event.currentTarget.elements.namedItem("expected_attendance") as HTMLInputElement;
    if (attendanceInput.validity.badInput) {
      setFieldErrors({ expected_attendance: "Enter a whole number greater than zero." });
      return;
    }
    const form = new FormData(event.currentTarget);
    const button = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = button?.value === "draft" ? "draft" : "submit";
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
      const result = await apiRequest<{ event: EventRecord }>(initialEvent ? `/events/${initialEvent.id}` : "/events", {
        method: initialEvent ? "PATCH" : "POST",
        body: JSON.stringify({
          ...details,
          action,
          // Convert the user's local time to an explicit UTC time for Flask.
          event_datetime: date ? date.toISOString() : null,
          expected_attendance: attendance === "" ? null : Number(attendance),
        }),
      });
      if (editing && result.event.status === "Draft") {
        // Keep the form open after saving edits. This is still the same event ID.
        setLastSaved(result.event.updated_at);
      } else {
        setSaved(result.event);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.fields);
        setError(error.message);
      } else {
        setError("Could not confirm that the request was saved. Check your connection and contact the team before retrying.");
      }
      // The buttons are at the bottom of a long form; bring its error into view.
      formElement.scrollIntoView({ block: "start" });
    } finally {
      setBusy(false);
    }
  }

  function fieldError(name: string) {
    return fieldErrors[name] ? (
      <p id={`${name}-error`} className="mt-1 text-sm text-red-300">{fieldErrors[name]}</p>
    ) : null;
  }

  if (saved) {
    return (
      <section role="status" className="space-y-4 rounded-lg border border-green-700 bg-slate-900 p-6">
        <h2 className="text-xl font-semibold text-green-300">
          {saved.status === "Draft" ? "Draft saved" : "Event request received"}
        </h2>
        <p>{saved.status === "Draft"
          ? "Your draft has been saved. It has not been submitted for review."
          : "Your request has been submitted and is now under Planning."}</p>
        <dl className="space-y-2 text-sm">
          <div><dt className="text-slate-400">Reference</dt><dd className="break-all font-mono">{saved.id}</dd></div>
          <div><dt className="text-slate-400">Saved at</dt><dd>{new Date(saved.updated_at ?? saved.created_at).toLocaleString()}</dd></div>
        </dl>
        <Link href={saved.status === "Draft" ? `/events/drafts/${saved.id}` : `/events/${saved.id}`} className="inline-flex rounded-full bg-sky-300 px-5 py-2.5 font-semibold text-slate-950">
          {saved.status === "Draft" ? "Continue editing" : "View event status"}
        </Link>
        <Link href="/events/drafts" className="inline-flex px-4 py-2 text-sm text-slate-300 hover:text-white">My drafts</Link>
        {!editing && <button type="button" disabled={!canCreate} onClick={() => setSaved(null)}
          className="rounded bg-sky-300 px-4 py-2 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
          Create another request
        </button>}
      </section>
    );
  }

  return (
    <form onSubmit={saveRequest} onChange={() => setLastSaved(null)} noValidate className="space-y-6 rounded-2xl border border-white/10 bg-slate-900/70 p-5 sm:p-8">
      <p className="text-sm text-slate-300">Fields marked * are required to submit. You can save a draft with these fields blank.</p>
      {editing && <p className="text-xs leading-relaxed text-slate-400">Only you can access this draft. Save your changes before leaving this page.</p>}
      {error && <p role="alert" className="rounded border border-red-700 bg-red-950/40 p-3 text-red-200">{error}</p>}
      <fieldset disabled={busy || !canCreate} className="space-y-5 disabled:opacity-40">
        <legend className="sr-only">Event details</legend>
        {TEXT_FIELDS.map((field) => (
          <div key={field.name}>
            <label htmlFor={field.name} className="mb-2 block font-medium">{field.label} *</label>
            {field.multiline ? (
              <textarea id={field.name} name={field.name} rows={3} maxLength={field.limit}
                defaultValue={initialEvent?.[field.name as keyof EventRecord] ?? ""}
                aria-required={field.required} aria-invalid={!!fieldErrors[field.name]}
                aria-describedby={fieldErrors[field.name] ? `${field.name}-error` : undefined}
                className={INPUT_STYLE} />
            ) : (
              <input id={field.name} name={field.name} type="text" maxLength={field.limit}
                defaultValue={initialEvent?.[field.name as keyof EventRecord] ?? ""}
                aria-required={field.required} aria-invalid={!!fieldErrors[field.name]}
                aria-describedby={fieldErrors[field.name] ? `${field.name}-error` : undefined}
                className={INPUT_STYLE} />
            )}
            {fieldError(field.name)}
          </div>
        ))}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="event_datetime" className="mb-2 block font-medium">Preferred date and time *</label>
            <input id="event_datetime" name="event_datetime" type="datetime-local" aria-required="true"
              defaultValue={localDateTime(initialEvent?.event_datetime)}
              aria-invalid={!!fieldErrors.event_datetime}
              aria-describedby={fieldErrors.event_datetime ? "event-time-help event_datetime-error" : "event-time-help"}
              className={INPUT_STYLE} />
            <p id="event-time-help" className="mt-1 text-sm text-slate-400">Uses your device&apos;s time zone.</p>
            {fieldError("event_datetime")}
          </div>
          <div>
            <label htmlFor="expected_attendance" className="mb-2 block font-medium">Expected attendance *</label>
            <input id="expected_attendance" name="expected_attendance" type="number" min="1" step="1" max="2147483647"
              defaultValue={initialEvent?.expected_attendance ?? ""}
              aria-required="true" aria-invalid={!!fieldErrors.expected_attendance}
              aria-describedby={fieldErrors.expected_attendance ? "expected_attendance-error" : undefined}
              className={INPUT_STYLE} />
            {fieldError("expected_attendance")}
          </div>
        </div>
        <fieldset className="space-y-5 border-t border-slate-700 pt-4">
          <legend className="px-2 font-semibold">Additional requirements (optional)</legend>
          {REQUIREMENT_FIELDS.map((field) => (
            <div key={field.name}>
              <label htmlFor={field.name} className="mb-2 block font-medium">{field.label}</label>
              <textarea id={field.name} name={field.name} rows={2} maxLength={2000}
                defaultValue={initialEvent?.[field.name as keyof EventRecord] ?? ""}
                aria-invalid={!!fieldErrors[field.name]}
                aria-describedby={fieldErrors[field.name] ? `${field.name}-error` : undefined}
                className={INPUT_STYLE} />
              {fieldError(field.name)}
            </div>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <button type="submit" value="submit" className="rounded-full bg-sky-300 px-6 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-200 disabled:opacity-50 motion-reduce:transition-none">
            {busy ? "Saving…" : "Submit request"}
          </button>
          <button type="submit" value="draft" className="rounded-full border border-white/20 px-6 py-3 text-sm font-medium transition-colors hover:bg-white/5 disabled:opacity-50 motion-reduce:transition-none">
            {editing ? "Save changes" : "Save as draft"}
          </button>
        </div>
      </fieldset>
      {lastSaved && <p role="status" className="rounded-xl border border-emerald-300/20 bg-emerald-300/5 px-4 py-3 text-sm text-emerald-200">Changes saved · {new Date(lastSaved).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
    </form>
  );
}
