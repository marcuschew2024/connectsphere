"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, ChevronDown, Search, SlidersHorizontal, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VENUE_ACCESSIBILITY_FEATURES, VENUE_FACILITIES, VENUE_LAYOUTS } from "@/lib/venues";
import OtherValuesInput from "@/components/other-values-input";

export type VenueSearchInitialValues = {
  attendance: string;
  layout: string;
  facilities: string;
  accessibility: string;
  date: string;
  start_time: string;
  end_time: string;
};

export default function VenueSearchForm({
  onSearch,
  busy,
  initialValues,
}: {
  onSearch: (query: string) => void;
  busy: boolean;
  initialValues: VenueSearchInitialValues;
}) {
  const [selected, setSelected] = useState({
    facilities: initialValues.facilities,
    accessibility: initialValues.accessibility,
  });
  const [customOther, setCustomOther] = useState({ facilities: false, accessibility: false });
  const [attendance, setAttendance] = useState(initialValues.attendance);
  const [layout, setLayout] = useState(initialValues.layout);
  const [layoutOther, setLayoutOther] = useState(
    initialValues.layout
      .split(",")
      .map((value) => value.trim())
      .filter((value) => !VENUE_LAYOUTS.some((layout) => layout.toLowerCase() === value.toLowerCase()))
      .join(", "),
  );
  const [layoutOtherEnabled, setLayoutOtherEnabled] = useState(
    Boolean(initialValues.layout
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .some((value) => !VENUE_LAYOUTS.some((layout) => layout.toLowerCase() === value.toLowerCase()))),
  );
  const [slot, setSlot] = useState({
    date: initialValues.date,
    start_time: initialValues.start_time,
    end_time: initialValues.end_time,
  });
  const [availableOnly, setAvailableOnly] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);

  const slotStarted = Boolean(slot.date || slot.start_time || slot.end_time);
  const slotComplete = Boolean(slot.date && slot.start_time && slot.end_time);

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

  function toggleFeature(key: "facilities" | "accessibility", feature: string) {
    const values = selected[key].split(",").map((value) => value.trim()).filter(Boolean);
    const present = values.some((value) => value.toLowerCase() === feature.toLowerCase());
    setSelected({ ...selected, [key]: (present
      ? values.filter((value) => value.toLowerCase() !== feature.toLowerCase())
      : [...values, feature]).join(", ") });
  }

  const selectedLayouts = layout.split(",").map((value) => value.trim()).filter(Boolean);
  const toggleLayout = (value: string) => {
    setLayout(selectedLayouts.some((item) => item.toLowerCase() === value.toLowerCase())
      ? selectedLayouts.filter((item) => item.toLowerCase() !== value.toLowerCase()).join(", ")
      : [...selectedLayouts, value].join(", "));
  };

  return <form onSubmit={search} onReset={() => {
    setSelected({ facilities: "", accessibility: "" });
    setCustomOther({ facilities: false, accessibility: false });
    setAttendance("");
    setLayout("");
    setLayoutOther("");
    setLayoutOtherEnabled(false);
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
          <Input className="h-10 bg-background" name="attendance" type="number" min={1} max={2147483647} step={1} placeholder="How many people?" value={attendance} onChange={(event) => setAttendance(event.target.value)} />
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
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm">Location
              <Input className="h-10 bg-background" name="location" maxLength={300} placeholder="Any location" />
            </label>
            <label className="space-y-2 text-sm">Minimum capacity
              <Input className="h-10 bg-background" name="capacity" type="number" min={1} max={2147483647} step={1} placeholder="Optional extra room" aria-describedby="capacity-help" />
            </label>
          </div>
          <fieldset className="space-y-3 text-sm">
            <legend className="font-medium">Layouts</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {VENUE_LAYOUTS.map((option) => (
                <label key={option} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
                  <input type="checkbox" checked={selectedLayouts.some((value) => value.toLowerCase() === option.toLowerCase())} onChange={() => toggleLayout(option)} />
                  {option}
                </label>
              ))}
              <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
                <input type="checkbox" checked={layoutOtherEnabled} onChange={(event) => {
                  setLayoutOtherEnabled(event.target.checked);
                  if (!event.target.checked) setLayoutOther("");
                }} />
                Other
              </label>
            </div>
            {layoutOtherEnabled && <OtherValuesInput id="layout-other" label="Other layouts" value={layoutOther} onChange={setLayoutOther} placeholder="Enter layouts separated by commas" />}
            <input type="hidden" name="layout" value={[...selectedLayouts.filter((value) => VENUE_LAYOUTS.some((option) => option.toLowerCase() === value.toLowerCase())), ...layoutOther.split(",").map((value) => value.trim()).filter(Boolean)].join(", ")} />
          </fieldset>
          <p id="capacity-help" className="text-xs text-muted-foreground">Attendance already checks that everyone fits. Use minimum capacity only if you need extra space.</p>
          {(["facilities", "accessibility"] as const).map((key) => {
            const presets = key === "facilities" ? VENUE_FACILITIES : VENUE_ACCESSIBILITY_FEATURES;
            const values = selected[key].split(",").map((value) => value.trim()).filter(Boolean);
            const custom = values.filter((value) => !presets.some((preset) => preset.toLowerCase() === value.toLowerCase()));
            const setCustom = (value: string) => setSelected({ ...selected, [key]: [...values.filter((item) => presets.some((preset) => preset.toLowerCase() === item.toLowerCase())), ...value.split(",").map((item) => item.trim()).filter(Boolean)].join(", ") });
            return <div key={key} className="space-y-3">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{key === "facilities" ? "Required facilities" : "Accessibility features"}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[...presets].filter((feature) => feature.toLowerCase() !== "lift").map((feature) => (
                    <label key={feature} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                      <input type="checkbox" checked={values.some((value) => value.toLowerCase() === feature.toLowerCase())} onChange={() => toggleFeature(key, feature)} />{feature}
                    </label>
                  ))}
                  <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <input type="checkbox" checked={customOther[key] || custom.length > 0} onChange={(event) => {
                      setCustomOther({ ...customOther, [key]: event.target.checked });
                      if (!event.target.checked) setCustom("");
                    }} />Other
                  </label>
                </div>
              </fieldset>
              {(customOther[key] || custom.length > 0) && <OtherValuesInput id={`${key}-other`} label={`Other ${key}`} value={custom.join(", ")} onChange={setCustom} placeholder="Enter one or more values separated by commas" />}
              <input type="hidden" name={key} value={selected[key]} />
            </div>;
          })}
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
