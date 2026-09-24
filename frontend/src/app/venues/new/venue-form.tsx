"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { defaultOpeningHours, VENUE_DAYS, VENUE_LAYOUTS, type OpeningHours, type Venue } from "@/lib/venues";

const INPUT = "w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm focus:border-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-300 [color-scheme:dark]";
const CARD = "space-y-5 rounded-2xl border border-white/10 bg-slate-900/50 p-5 sm:p-6";

export default function VenueForm() {
  const [hours, setHours] = useState<OpeningHours>(defaultOpeningHours);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Venue | null>(null);
  const [formKey, setFormKey] = useState(0);
  const errorSummary = useRef<HTMLDivElement>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  useEffect(() => { if (saved) successHeading.current?.focus(); }, [saved]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setFields({});
    const features = (key: string) => String(form.get(key) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    try {
      const result = await apiRequest<{ venue: Venue }>("/venues", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"), location: form.get("location"), capacity: Number(form.get("capacity")),
          facilities: features("facilities"), accessibility: features("accessibility"),
          supported_layouts: form.getAll("supported_layouts"), operating_hours: hours,
        }),
      });
      setSaved(result.venue);
    } catch (error) {
      setError(error instanceof ApiError ? error.message : "Could not confirm the venue was saved. Check the catalogue before retrying.");
      if (error instanceof ApiError) setFields(error.fields);
    } finally { setBusy(false); }
  }

  function fieldError(field: string) {
    return fields[field] ? <p id={`${field}-error`} className="mt-2 text-xs text-rose-300">{fields[field]}</p> : null;
  }

  if (saved) return <section role="status" className="max-w-2xl rounded-2xl border border-emerald-300/25 bg-emerald-300/5 p-6 sm:p-8">
    <p className="mb-3 text-2xl text-emerald-300" aria-hidden="true">✓</p>
    <h2 ref={successHeading} tabIndex={-1} className="text-2xl font-semibold outline-none">Venue added</h2>
    <p className="mt-3 break-words text-sm leading-relaxed text-slate-300"><strong>{saved.name}</strong> is now in the shared catalogue. Coordinators can see its details.</p>
    <p className="mt-2 text-xs text-slate-400">Added {new Date(saved.created_at).toLocaleString()}</p>
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Link href="/venues" className="rounded-xl bg-sky-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-200">View catalogue</Link>
      <button type="button" onClick={() => { setSaved(null); setHours(defaultOpeningHours()); setFormKey(formKey + 1); }} className="rounded-xl border border-white/15 px-5 py-3 text-sm text-slate-200 hover:bg-white/5">Add another venue</button>
    </div>
  </section>;

  return <form key={formKey} onSubmit={save} noValidate className="space-y-5">
    {error && <div ref={errorSummary} tabIndex={-1} role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-4 text-sm text-rose-200 outline-none">{error}</div>}
    <fieldset disabled={busy} className="grid items-start gap-5 disabled:opacity-60 lg:grid-cols-2">
      <legend className="sr-only">Venue details</legend>
      <div className="space-y-5">
        <section className={CARD}>
          <div><h2 className="font-semibold">The space</h2><p className="mt-1 text-xs text-slate-400">Give the venue a clear name and location. * Required</p></div>
          {([['name', 'Venue name', 200, 'e.g. Seminar Room A'], ['location', 'Location', 300, 'e.g. Building B, Level 2']] as const).map(([key, label, limit, placeholder]) => <div key={key}>
            <label htmlFor={key} className="mb-2 block text-sm font-medium">{label} *</label>
            <input id={key} name={key} required maxLength={limit} placeholder={placeholder} className={INPUT} aria-invalid={!!fields[key]} aria-describedby={fields[key] ? `${key}-error` : undefined} />
            {fieldError(key)}
          </div>)}
          <div><label htmlFor="capacity" className="mb-2 block text-sm font-medium">Capacity *</label><input id="capacity" name="capacity" type="number" required min="1" max="2147483647" step="1" placeholder="Maximum number of people" className={INPUT} aria-invalid={!!fields.capacity} aria-describedby={fields.capacity ? "capacity-error" : undefined} />{fieldError("capacity")}</div>
        </section>
        <section className={CARD}>
          <h2 className="font-semibold">Facilities & layouts</h2>
          {([['facilities', 'Facilities', 'Projector, Wi-Fi, whiteboard'], ['accessibility', 'Accessibility features', 'Step-free access, accessible toilet']] as const).map(([key, label, placeholder]) => <div key={key}>
            <label htmlFor={key} className="mb-2 block text-sm font-medium">{label}</label>
            <textarea id={key} name={key} rows={2} maxLength={1640} placeholder={placeholder} className={INPUT} aria-invalid={!!fields[key]} aria-describedby={`${key}-help${fields[key] ? ` ${key}-error` : ""}`} />
            <p id={`${key}-help`} className="mt-1 text-xs text-slate-500">Separate features with commas. Leave blank if none.</p>{fieldError(key)}
          </div>)}
          <fieldset aria-describedby={fields.supported_layouts ? "supported_layouts-error" : undefined}>
            <legend className="mb-3 text-sm font-medium">Supported layouts *</legend>
            <div className="grid grid-cols-2 gap-2">{VENUE_LAYOUTS.map((layout) => <label key={layout} className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-2.5 text-sm text-slate-300 has-checked:border-sky-300/50 has-checked:bg-sky-300/5"><input type="checkbox" name="supported_layouts" value={layout} className="h-4 w-4 accent-sky-300" />{layout}</label>)}</div>
            {fieldError("supported_layouts")}
          </fieldset>
        </section>
      </div>
      <section className={CARD}>
        <div><h2 className="font-semibold">Opening hours *</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">Singapore time (UTC+8). Set one opening interval per day, or leave the day closed. Closing must be later on the same day.</p></div>
        {fieldError("operating_hours")}
        <div className="divide-y divide-white/10">{VENUE_DAYS.map((day) => <div key={day} className="py-3 first:pt-0 last:pb-0">
          <div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-medium capitalize">{day}</span><label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={hours[day] !== null} aria-label={`${day} open`} onChange={(event) => setHours({ ...hours, [day]: event.target.checked ? { opens: "09:00", closes: "18:00" } : null })} className="accent-sky-300" />{hours[day] ? "Open" : "Closed"}</label></div>
          {hours[day] && <div className="grid grid-cols-2 gap-3">{([['opens', 'Opens'], ['closes', 'Closes']] as const).map(([key, label]) => <label key={key} className="min-w-0 text-xs text-slate-500">{label}<input type="time" value={hours[day]![key]} aria-label={`${day} ${key}`} aria-invalid={!!fields[`operating_hours.${day}`]} aria-describedby={fields[`operating_hours.${day}`] ? `operating_hours.${day}-error` : undefined} onChange={(event) => setHours({ ...hours, [day]: { ...hours[day]!, [key]: event.target.value } })} className={`${INPUT} mt-1 min-w-0`} /></label>)}</div>}
          {fieldError(`operating_hours.${day}`)}
        </div>)}</div>
      </section>
    </fieldset>
    <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur-sm">
      <p className="max-w-md text-xs text-slate-400">Saving makes this venue visible to Coordinators.</p>
      <div className="flex items-center gap-3"><Link href="/venues" className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:text-white">Cancel</Link><button type="submit" disabled={busy} className="rounded-xl bg-sky-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-200 disabled:opacity-50">{busy ? "Saving…" : "Save venue"}</button></div>
    </div>
  </form>;
}
