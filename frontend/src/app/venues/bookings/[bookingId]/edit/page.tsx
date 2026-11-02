"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import {
  bookingChangeRefusal,
  extraValues,
  joinRequirements,
  presetValues,
  requirementValues,
  type BookingRecord,
} from "@/lib/bookings";
import {
  VENUE_ACCESSIBILITY_FEATURES,
  VENUE_FACILITIES,
  VENUE_LAYOUTS,
  type Venue,
} from "@/lib/venues";
import OtherValuesInput from "@/components/other-values-input";
import { AppShell } from "@/components/app-shell";
import { useActingRole } from "@/lib/use-acting-role";

const INPUT = "w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30";
const CHOICE = "flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm";

function localValue(iso: string) {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return Number.isNaN(date.getTime()) ? "" : local.toISOString().slice(0, 16);
}

/** One checkbox group, matching the layout/facility/accessibility groups on the request form. */
function ChoiceGroup({
  legend, options, selected, onToggle, otherId, otherLabel, otherPlaceholder,
  otherEnabled, onOtherEnabled, otherValue, onOtherValue, columns,
}: {
  legend: string;
  options: string[];
  selected: string[];
  onToggle: (option: string, checked: boolean) => void;
  otherId: string;
  otherLabel: string;
  otherPlaceholder: string;
  otherEnabled: boolean;
  onOtherEnabled: (checked: boolean) => void;
  otherValue: string;
  onOtherValue: (value: string) => void;
  columns: string;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className={`grid gap-2 ${columns}`}>
        {options.map((option) => (
          <label key={option} className={CHOICE}>
            <input
              type="checkbox"
              checked={selected.some((value) => value.toLowerCase() === option.toLowerCase())}
              onChange={(event) => onToggle(option, event.target.checked)}
            />
            {option}
          </label>
        ))}
        <label className={CHOICE}>
          <input
            type="checkbox"
            aria-label={`${legend} Other`}
            checked={otherEnabled}
            onChange={(event) => onOtherEnabled(event.target.checked)}
          />
          Other
        </label>
      </div>
      {otherEnabled && (
        <OtherValuesInput
          id={otherId}
          label={otherLabel}
          value={otherValue}
          onChange={onOtherValue}
          placeholder={otherPlaceholder}
        />
      )}
    </fieldset>
  );
}

export default function EditBookingPage() {
  const params = useParams<{ bookingId: string }>();
  const router = useRouter();
  const [role, , , , userId] = useActingRole();
  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [attendance, setAttendance] = useState("");
  const [layouts, setLayouts] = useState<string[]>([]);
  const [layoutOther, setLayoutOther] = useState("");
  const [layoutOtherEnabled, setLayoutOtherEnabled] = useState(false);
  const [facilities, setFacilities] = useState<string[]>([]);
  const [facilityOther, setFacilityOther] = useState("");
  const [facilityOtherEnabled, setFacilityOtherEnabled] = useState(false);
  const [accessibility, setAccessibility] = useState<string[]>([]);
  const [accessibilityOther, setAccessibilityOther] = useState("");
  const [accessibilityOtherEnabled, setAccessibilityOtherEnabled] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      apiRequest<{ booking: BookingRecord }>(`/venues/bookings/${params.bookingId}`),
      apiRequest<{ venues: Venue[] }>("/venues?page=1"),
    ]).then(([bookingResult, venueResult]) => {
      const value = bookingResult.booking;
      setBooking(value);
      setVenues(venueResult.venues);
      setVenueId(value.venue_id);
      setStart(localValue(value.start_at));
      setEnd(localValue(value.end_at));
      setAttendance(String(value.expected_attendance));

      // Split the stored text back into ticked presets plus anything custom, so an
      // existing booking keeps entries this form has no checkbox for.
      const storedLayouts = requirementValues(value.layout);
      const customLayouts = extraValues(storedLayouts, VENUE_LAYOUTS);
      setLayouts(presetValues(storedLayouts, VENUE_LAYOUTS));
      setLayoutOther(customLayouts.join(", "));
      setLayoutOtherEnabled(customLayouts.length > 0);

      const stored = requirementValues(value.special_requirements);
      setFacilities(presetValues(stored, VENUE_FACILITIES));
      setAccessibility(presetValues(stored, VENUE_ACCESSIBILITY_FEATURES));
      // Requirements are stored as one list, so a value matching neither catalogue cannot
      // be attributed to facilities or accessibility. It is kept under Facilities > Other
      // rather than dropped.
      const custom = extraValues(stored, VENUE_FACILITIES, VENUE_ACCESSIBILITY_FEATURES);
      setFacilityOther(custom.join(", "));
      setFacilityOtherEnabled(custom.length > 0);
    }).catch((requestError) => setError(requestError instanceof ApiError ? requestError.message : "Could not load this booking."));
  }, [params.bookingId]);

  // D59: SCRUM-21/130 moved change authority from the booking's requester (D52) to the
  // event's current Coordinator, so read the server's can_manage rather than comparing
  // requested_by -- after a reassignment those two disagree.
  const refusal = booking && bookingChangeRefusal(booking.status, {
    isCoordinator: role === "Coordinator",
    canManage: booking.can_manage ?? booking.requested_by === userId,
  });
  const editable = booking !== null && !refusal;

  function toggle(
    current: string[],
    set: (values: string[]) => void,
  ): (option: string, checked: boolean) => void {
    return (option, checked) => set(checked
      ? [...current, option]
      : current.filter((value) => value.toLowerCase() !== option.toLowerCase()));
  }

  async function save() {
    if (!booking || !editable || busy) return;
    setBusy(true); setError("");
    const selectedVenue = venues.find((venue) => venue.id === venueId);
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (!selectedVenue || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setError("Choose a venue and valid start and end times."); setBusy(false); return;
    }
    if (endDate <= startDate) { setError("The end date and time must be after the start date and time."); setBusy(false); return; }
    const count = Number(attendance);
    if (!Number.isInteger(count) || count < 1 || count > selectedVenue.capacity) { setError(`Expected attendance must be between 1 and ${selectedVenue.capacity}.`); setBusy(false); return; }
    const layout = joinRequirements(layouts, requirementValues(layoutOther));
    if (!layout) { setError("Choose at least one layout."); setBusy(false); return; }
    const special = joinRequirements(
      facilities, requirementValues(facilityOther),
      accessibility, requirementValues(accessibilityOther),
    );
    try {
      await apiRequest<{ booking: BookingRecord }>(`/venues/bookings/${booking.id}`, { method: "PATCH", body: JSON.stringify({ venue_id: venueId, start_at: startDate.toISOString(), end_at: endDate.toISOString(), expected_attendance: count, layout, special_requirements: special }) });
      router.push(`/events/${booking.event_id}`);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not change this booking.");
    } finally { setBusy(false); }
  }

  return <AppShell actingRole={role}><main className="mx-auto max-w-3xl space-y-6 px-5 py-8 sm:px-8 sm:py-10"><header><p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Coordinator workspace</p><h1 className="mt-2 text-3xl font-semibold">Change venue booking</h1><p className="mt-2 text-sm text-muted-foreground">Only this booking changes; the event and sibling bookings remain intact.</p></header>{error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}{booking && refusal && <p role="status">{refusal}</p>}{booking && editable && <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
    <label className="block text-sm font-medium">Venue<select value={venueId} onChange={(event) => setVenueId(event.target.value)} className={`${INPUT} mt-2`}>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name} · capacity {venue.capacity}</option>)}</select></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Start<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className={`${INPUT} mt-2`} /></label><label className="block text-sm font-medium">End<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} className={`${INPUT} mt-2`} /></label></div>
    <label className="block max-w-xs text-sm font-medium">Expected attendance<input type="number" min="1" value={attendance} onChange={(event) => setAttendance(event.target.value)} className={`${INPUT} mt-2`} /></label>
    <ChoiceGroup
      legend="Layout" options={VENUE_LAYOUTS} selected={layouts}
      onToggle={toggle(layouts, setLayouts)}
      otherId="other-layouts" otherLabel="Other layouts"
      otherPlaceholder="Enter one or more layouts separated by commas"
      otherEnabled={layoutOtherEnabled}
      onOtherEnabled={(checked) => { setLayoutOtherEnabled(checked); if (!checked) setLayoutOther(""); }}
      otherValue={layoutOther} onOtherValue={setLayoutOther}
      columns="sm:grid-cols-2 lg:grid-cols-4"
    />
    <ChoiceGroup
      legend="Facilities" options={VENUE_FACILITIES} selected={facilities}
      onToggle={toggle(facilities, setFacilities)}
      otherId="other-facilities" otherLabel="Other facilities"
      otherPlaceholder="Enter one or more facilities separated by commas"
      otherEnabled={facilityOtherEnabled}
      onOtherEnabled={(checked) => { setFacilityOtherEnabled(checked); if (!checked) setFacilityOther(""); }}
      otherValue={facilityOther} onOtherValue={setFacilityOther}
      columns="sm:grid-cols-2"
    />
    <ChoiceGroup
      legend="Accessibility" options={VENUE_ACCESSIBILITY_FEATURES} selected={accessibility}
      onToggle={toggle(accessibility, setAccessibility)}
      otherId="other-accessibility-features" otherLabel="Other accessibility features"
      otherPlaceholder="Enter one or more features separated by commas"
      otherEnabled={accessibilityOtherEnabled}
      onOtherEnabled={(checked) => { setAccessibilityOtherEnabled(checked); if (!checked) setAccessibilityOther(""); }}
      otherValue={accessibilityOther} onOtherValue={setAccessibilityOther}
      columns="sm:grid-cols-2"
    />
    <div className="flex gap-3"><button type="submit" disabled={busy} className="rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Saving..." : "Save booking change"}</button><Link href={`/events/${booking.event_id}`} className="rounded-md border border-border px-5 py-3 text-sm">Cancel</Link></div>
  </form>}</main></AppShell>;
}
