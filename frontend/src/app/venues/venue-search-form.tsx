"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, ChevronDown, Search, SlidersHorizontal, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api";
import { VENUE_LAYOUTS } from "@/lib/venues";

type Features = { facilities: string[]; accessibility: string[] };

export default function VenueSearchForm({ onSearch, busy }: { onSearch: (query: string) => void; busy: boolean }) {
  const [features, setFeatures] = useState<Features>({ facilities: [], accessibility: [] });
  const [selected, setSelected] = useState({ facilities: "", accessibility: "" });
  const [slot, setSlot] = useState({ date: "", start_time: "", end_time: "" });
  const [availableOnly, setAvailableOnly] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const slotStarted = Boolean(slot.date || slot.start_time || slot.end_time);
  const slotComplete = Boolean(slot.date && slot.start_time && slot.end_time);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<Features>("/venues/filter-options", { signal: controller.signal })
      .then((values) => { if (!controller.signal.aborted) setFeatures(values); })
      // Manual feature entry stays usable if suggestions cannot be loaded.
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (slotStarted && !slotComplete) {
      setError("Choose a date, start time and end time together (Singapore time).");
      return;
    }
    if (slotComplete && slot.end_time <= slot.start_time) {
      setError("End time must be after start time on the same day.");
      return;
    }
    setError("");
    const query = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => {
      if (String(value).trim()) query.set(key, String(value).trim());
    });
    onSearch(query.toString());
  }

  function toggleFeature(key: keyof Features, feature: string) {
    const values = selected[key].split(",").map((value) => value.trim()).filter(Boolean);
    const present = values.some((value) => value.toLowerCase() === feature.toLowerCase());
    setSelected({ ...selected, [key]: (present
      ? values.filter((value) => value.toLowerCase() !== feature.toLowerCase())
      : [...values, feature]).join(", ") });
  }

  return <form onSubmit={search} onReset={() => {
    setSelected({ facilities: "", accessibility: "" });
    setSlot({ date: "", start_time: "", end_time: "" });
    setAvailableOnly(false); setError(""); onSearch("");
  }} id="venue-search" aria-label="Venue search" className="overflow-hidden rounded-xl border border-border bg-muted/60">
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-background p-2 text-muted-foreground"><Search className="size-5" aria-hidden="true" /></div>
        <div><h2 className="text-sm font-semibold">Search and filter venues</h2>
          <p className="mt-1 text-xs text-muted-foreground">Start with your event’s headcount and timing. Then narrow down the spaces that fit.</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid content-start gap-2 text-sm font-medium"><span className="flex items-center gap-1.5"><Users className="size-4 text-muted-foreground" aria-hidden="true" />Expected attendance</span>
          <Input className="h-10 bg-background" name="attendance" type="number" min={1} max={2147483647} step={1} placeholder="How many people?" />
        </label>
        <label className="grid content-start gap-2 text-sm font-medium"><span className="flex items-center gap-1.5"><CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />Date</span>
          <Input className="h-10 bg-background" name="date" type="date" value={slot.date} onChange={(event) => { setSlot({ ...slot, date: event.target.value }); setError(""); }} aria-describedby="time-help" />
        </label>
        <label className="grid content-start gap-2 text-sm font-medium">Start time
          <Input className="h-10 bg-background" name="start_time" type="time" value={slot.start_time} onChange={(event) => { setSlot({ ...slot, start_time: event.target.value }); setError(""); }} aria-describedby="time-help" />
        </label>
        <label className="grid content-start gap-2 text-sm font-medium">End time
          <Input className="h-10 bg-background" name="end_time" type="time" value={slot.end_time} onChange={(event) => { setSlot({ ...slot, end_time: event.target.value }); setError(""); }} aria-describedby="time-help" />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 py-1">
        <p id="time-help" className="text-xs text-muted-foreground">Singapore time · Leave all three time fields blank to browse.</p>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" name="available_only" value="true" className="size-4 accent-primary" disabled={!slotComplete}
            checked={availableOnly && slotComplete} onChange={(event) => setAvailableOnly(event.target.checked)} />
          Only show available venues
        </label>
      </div>
      <details className="group rounded-lg border border-border bg-background/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />More requirements</span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-5 border-t border-border p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2 text-sm">Location
              <Input className="h-10 bg-background" name="location" maxLength={300} placeholder="Any location" />
            </label>
            <div className="space-y-2 text-sm">
              <label htmlFor="search-layout">Layout</label>
              <select id="search-layout" name="layout" className="h-10 w-full rounded-lg border border-input bg-background px-2 text-foreground">
                <option value="">Any layout</option>
                {VENUE_LAYOUTS.map((layout) => <option key={layout}>{layout}</option>)}
              </select>
            </div>
            <label className="space-y-2 text-sm">Minimum capacity
              <Input className="h-10 bg-background" name="capacity" type="number" min={1} max={2147483647} step={1} placeholder="Optional extra room" aria-describedby="capacity-help" />
            </label>
          </div>
          <p id="capacity-help" className="text-xs text-muted-foreground">Attendance already checks that everyone fits. Use minimum capacity only if you need extra space.</p>
          {(["facilities", "accessibility"] as const).map((key) => <div key={key} className="space-y-3">
            <label className="block space-y-2 text-sm font-medium">{key === "facilities" ? "Required facilities" : "Accessibility features"}
              <Input className="h-10 font-normal" name={key} maxLength={1619} value={selected[key]} onChange={(event) => setSelected({ ...selected, [key]: event.target.value })}
                placeholder={key === "facilities" ? "e.g. Projector, Wi-Fi" : "e.g. Step-free access"} aria-describedby="feature-help" />
            </label>
            {features[key].length > 0 && <div className="flex flex-wrap gap-2" role="group" aria-label={`${key} suggestions`}>
              {features[key].map((feature) => {
                const active = selected[key].split(",").some((value) => value.trim().toLowerCase() === feature.toLowerCase());
                return <button key={feature} type="button" aria-pressed={active} onClick={() => toggleFeature(key, feature)}
                  className={`min-h-9 rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring ${active ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-background text-muted-foreground hover:border-primary hover:text-foreground"}`}>
                  {active ? "✓ " : "+ "}{feature}
                </button>;
              })}
            </div>}
          </div>)}
          <p id="feature-help" className="text-xs text-muted-foreground">Pick features from the catalogue above, or type names separated by commas. A venue must have every feature you select.</p>
        </div>
      </details>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 sm:px-5">
      <Button type="submit" disabled={busy}><Search className="mr-1 size-4" aria-hidden="true" />Search venues</Button>
      <Button type="reset" variant="outline" disabled={busy}>Clear filters</Button>
      <p className="text-xs text-muted-foreground sm:ml-auto">Compare spaces, check suitability, then request a booking.</p>
    </div>
  </form>;
}
