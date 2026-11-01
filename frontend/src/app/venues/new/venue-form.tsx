"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { defaultOpeningHours, VENUE_ACCESSIBILITY_FEATURES, VENUE_DAYS, VENUE_FACILITIES, VENUE_LAYOUTS, type OpeningHours, type Venue } from "@/lib/venues";
import OtherValuesInput from "@/components/other-values-input";

const INPUT = "w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30";
const CARD = "space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6";

export default function VenueForm({ venue }: { venue?: Venue }) {
  const editing = !!venue;
  const layouts = Array.from(new Set([...VENUE_LAYOUTS, ...(venue?.supported_layouts ?? [])]));
  const isKnown = (values: string[], value: string) =>
    values.some((known) => known.toLowerCase() === value.toLowerCase());
  const customValues = (values: string[], known: string[]) =>
    values.filter((value) => !isKnown(known, value));
  const [facilityOther, setFacilityOther] = useState(customValues(venue?.facilities ?? [], VENUE_FACILITIES).join(", "));
  const [accessibilityOther, setAccessibilityOther] = useState(customValues(venue?.accessibility ?? [], VENUE_ACCESSIBILITY_FEATURES).join(", "));
  const [layoutOther, setLayoutOther] = useState(customValues(venue?.supported_layouts ?? [], VENUE_LAYOUTS).join(", "));
  const [showFacilityOther, setShowFacilityOther] = useState(customValues(venue?.facilities ?? [], VENUE_FACILITIES).length > 0);
  const [showAccessibilityOther, setShowAccessibilityOther] = useState(customValues(venue?.accessibility ?? [], VENUE_ACCESSIBILITY_FEATURES).length > 0);
  const [showLayoutOther, setShowLayoutOther] = useState(customValues(venue?.supported_layouts ?? [], VENUE_LAYOUTS).length > 0);
  const [hours, setHours] = useState<OpeningHours>(() => venue?.operating_hours ?? defaultOpeningHours());
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
    const selected = (key: string) => form.getAll(key).map(String);
    const selectedWithOther = (key: string, value: string) => {
      const choices = selected(key);
      return [
        ...choices.filter((choice) => choice !== "Other"),
        ...(choices.includes("Other") ? value.split(",").map((item) => item.trim()).filter(Boolean) : []),
      ];
    };
    try {
      const result = await apiRequest<{ venue: Venue }>(editing ? `/venues/${venue.id}` : "/venues", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({
          ...(editing ? { revision: venue.revision } : { name: form.get("name"), location: form.get("location") }), capacity: Number(form.get("capacity")),
          setup_time_minutes: Number(form.get("setup_time_minutes") ?? 0),
          turnaround_time_minutes: Number(form.get("turnaround_time_minutes") ?? 0),
          facilities: selectedWithOther("facilities", facilityOther),
          accessibility: selectedWithOther("accessibility", accessibilityOther),
          supported_layouts: selectedWithOther("supported_layouts", layoutOther),
          operating_hours: hours,
        }),
      });
      setSaved(result.venue);
    } catch (error) {
      setError(error instanceof ApiError ? error.message : "Could not confirm the venue was saved. Check the catalogue before retrying.");
      if (error instanceof ApiError) setFields(error.fields);
    } finally { setBusy(false); }
  }

  function fieldError(field: string) {
    return fields[field] ? <p id={`${field}-error`} className="mt-2 text-xs text-destructive">{fields[field]}</p> : null;
  }

  if (saved) return <section role="status" className="max-w-2xl rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8">
    <p className="mb-3 text-2xl text-primary" aria-hidden="true">✓</p>
    <h2 ref={successHeading} tabIndex={-1} className="text-2xl font-semibold outline-none">{editing ? "Venue updated" : "Venue added"}</h2>
    <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground"><strong className="text-foreground">{saved.name}</strong> {editing ? "has been updated. Future searches use these details. Confirmed bookings are unchanged." : "is now in the shared catalogue. Coordinators can see its details."}</p>
    <p className="mt-2 text-xs text-muted-foreground">{editing ? "Updated" : "Added"} {new Date(saved.updated_at ?? saved.created_at).toLocaleString()}</p>
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Link href="/venues" className="rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90">View catalogue</Link>
      {!editing && <button type="button" onClick={() => { setSaved(null); setHours(defaultOpeningHours()); setFormKey(formKey + 1); }} className="rounded-md border border-border px-5 py-3 text-sm text-foreground hover:bg-muted">Add another venue</button>}
    </div>
  </section>;

  return <form key={formKey} onSubmit={save} noValidate className="space-y-5">
    {error && <div ref={errorSummary} tabIndex={-1} role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive outline-none">{error}</div>}
    <fieldset disabled={busy} className="grid items-start gap-5 disabled:opacity-60 lg:grid-cols-2">
      <legend className="sr-only">Venue details</legend>
      <div className="space-y-5">
        <section className={CARD}>
          <div><h2 className="font-semibold">The space</h2><p className="mt-1 text-xs text-muted-foreground">{editing ? "Update this space’s details. Name and location stay the same. * Required" : "Give the venue a clear name and location. * Required"}</p></div>
          {([['name', 'Venue name', 200, 'e.g. Seminar Room A'], ['location', 'Location', 300, 'e.g. Building B, Level 2']] as const).map(([key, label, limit, placeholder]) => <div key={key}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor={key} className="block text-sm font-medium">{label} *</label>
              {editing && <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">Read-only</span>}
            </div>
            <input id={key} name={key} defaultValue={venue?.[key]} readOnly={editing} required maxLength={limit} placeholder={placeholder} className={editing ? "w-full cursor-not-allowed rounded-md border border-dashed border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" : INPUT} aria-invalid={!!fields[key]} aria-describedby={fields[key] ? `${key}-error` : undefined} />
            {fieldError(key)}
          </div>)}
          <div><label htmlFor="capacity" className="mb-2 block text-sm font-medium">Capacity *</label><input id="capacity" name="capacity" defaultValue={venue?.capacity} type="number" required min="1" max="2147483647" step="1" placeholder="Maximum number of people" className={INPUT} aria-invalid={!!fields.capacity} aria-describedby={fields.capacity ? "capacity-error" : undefined} />{fieldError("capacity")}</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="setup_time_minutes" className="mb-2 block text-sm font-medium">Setup buffer (mins)</label>
              <input id="setup_time_minutes" name="setup_time_minutes" defaultValue={venue?.setup_time_minutes ?? 0} type="number" min="0" max="1440" step="1" placeholder="0" className={INPUT} aria-invalid={!!fields.setup_time_minutes} aria-describedby={fields.setup_time_minutes ? "setup_time_minutes-error" : undefined} />
              {fieldError("setup_time_minutes")}
            </div>
            <div>
              <label htmlFor="turnaround_time_minutes" className="mb-2 block text-sm font-medium">Turnaround buffer (mins)</label>
              <input id="turnaround_time_minutes" name="turnaround_time_minutes" defaultValue={venue?.turnaround_time_minutes ?? 0} type="number" min="0" max="1440" step="1" placeholder="0" className={INPUT} aria-invalid={!!fields.turnaround_time_minutes} aria-describedby={fields.turnaround_time_minutes ? "turnaround_time_minutes-error" : undefined} />
              {fieldError("turnaround_time_minutes")}
            </div>
          </div>
        </section>
        <section className={CARD}>
          <h2 className="font-semibold">Facilities & layouts</h2>
          <fieldset>
            <legend className="mb-3 text-sm font-medium">Facilities</legend>
            <div className="grid grid-cols-2 gap-2">
              {VENUE_FACILITIES.map((facility) => <label key={facility} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground has-checked:border-primary/50 has-checked:bg-primary/5"><input type="checkbox" name="facilities" value={facility} defaultChecked={venue?.facilities.some((value) => value.toLowerCase() === facility.toLowerCase())} className="h-4 w-4 accent-primary" />{facility}</label>)}
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground has-checked:border-primary/50 has-checked:bg-primary/5"><input type="checkbox" name="facilities" value="Other" aria-label="Facilities Other" checked={showFacilityOther} onChange={(event) => setShowFacilityOther(event.target.checked)} className="h-4 w-4 accent-primary" />Other</label>
            </div>
            {showFacilityOther && <OtherValuesInput id="facility-other" label="Other facilities" value={facilityOther} onChange={setFacilityOther} placeholder="e.g. Video conferencing" />}
            {fieldError("facilities")}
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-sm font-medium">Accessibility features</legend>
            <div className="grid grid-cols-2 gap-2">
              {VENUE_ACCESSIBILITY_FEATURES.map((feature) => <label key={feature} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground has-checked:border-primary/50 has-checked:bg-primary/5"><input type="checkbox" name="accessibility" value={feature} defaultChecked={venue?.accessibility.some((value) => value.toLowerCase() === feature.toLowerCase())} className="h-4 w-4 accent-primary" />{feature}</label>)}
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground has-checked:border-primary/50 has-checked:bg-primary/5"><input type="checkbox" name="accessibility" value="Other" aria-label="Accessibility features Other" checked={showAccessibilityOther} onChange={(event) => setShowAccessibilityOther(event.target.checked)} className="h-4 w-4 accent-primary" />Other</label>
            </div>
            {showAccessibilityOther && <OtherValuesInput id="accessibility-other" label="Other accessibility features" value={accessibilityOther} onChange={setAccessibilityOther} placeholder="e.g. Tactile wayfinding" />}
            {fieldError("accessibility")}
          </fieldset>
          <fieldset aria-describedby={fields.supported_layouts ? "supported_layouts-error" : undefined}>
            <legend className="mb-3 text-sm font-medium">Supported layouts *</legend>
            <div className="grid grid-cols-2 gap-2">{layouts.filter((layout) => VENUE_LAYOUTS.some((known) => known.toLowerCase() === layout.toLowerCase())).map((layout) => <label key={layout} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground has-checked:border-primary/50 has-checked:bg-primary/5"><input type="checkbox" name="supported_layouts" value={layout} defaultChecked={venue?.supported_layouts.some((value) => value.toLowerCase() === layout.toLowerCase())} className="h-4 w-4 accent-primary" />{layout}</label>)}
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm text-foreground has-checked:border-primary/50 has-checked:bg-primary/5"><input type="checkbox" name="supported_layouts" value="Other" aria-label="Supported layouts Other" checked={showLayoutOther} onChange={(event) => setShowLayoutOther(event.target.checked)} className="h-4 w-4 accent-primary" />Other</label>
            </div>
            {showLayoutOther && <OtherValuesInput id="layout-other" label="Other supported layouts" value={layoutOther} onChange={setLayoutOther} placeholder="e.g. Cabaret" />}
            {fieldError("supported_layouts")}
          </fieldset>
        </section>
      </div>
      <section className={CARD}>
        <div><h2 className="font-semibold">Opening hours *</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Singapore time (UTC+8). Set one opening interval per day, or leave the day closed. Closing must be later on the same day.</p></div>
        {fieldError("operating_hours")}
        <div className="divide-y divide-border">{VENUE_DAYS.map((day) => <div key={day} className="py-3 first:pt-0 last:pb-0">
          <div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-medium capitalize">{day}</span><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={hours[day] !== null} aria-label={`${day} open`} onChange={(event) => setHours({ ...hours, [day]: event.target.checked ? { opens: "09:00", closes: "18:00" } : null })} className="accent-primary" />{hours[day] ? "Open" : "Closed"}</label></div>
          {hours[day] && <div className="grid grid-cols-2 gap-3">{([['opens', 'Opens'], ['closes', 'Closes']] as const).map(([key, label]) => <label key={key} className="min-w-0 text-xs text-muted-foreground">{label}<input type="time" value={hours[day]![key]} aria-label={`${day} ${key}`} aria-invalid={!!fields[`operating_hours.${day}`]} aria-describedby={fields[`operating_hours.${day}`] ? `operating_hours.${day}-error` : undefined} onChange={(event) => setHours({ ...hours, [day]: { ...hours[day]!, [key]: event.target.value } })} className={`${INPUT} mt-1 min-w-0`} /></label>)}</div>}
          {fieldError(`operating_hours.${day}`)}
        </div>)}</div>
      </section>
    </fieldset>
    <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/95 px-4 py-3 backdrop-blur-sm">
      <p className="max-w-md text-xs text-muted-foreground">{editing ? "Changes apply to future searches. Confirmed bookings stay unchanged." : "Saving makes this venue visible to Coordinators."}</p>
      <div className="flex items-center gap-3"><Link href="/venues" className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</Link><button type="submit" disabled={busy} className="rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{busy ? "Saving…" : editing ? "Save changes" : "Save venue"}</button></div>
    </div>
  </form>;
}
