"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { eventTime, type Registration } from "@/lib/registrations";
import { recordReference } from "@/lib/record-reference";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

type Roster = {
  event: { id: string; reference?: string; title: string | null; event_datetime: string | null; status: string };
  registrations: (Omit<Registration, "event_id"> & { attendee: { display_name: string } | null })[];
  capacity: number | null;
  counts: { registered_count: number; waitlisted_count: number; withdrawn_count: number };
  page: number;
  has_more: boolean;
};

export default function EventRegistrationsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [role, , roleLoading] = useActingRole();
  const allowedRole = role === "Organiser" || role === "Coordinator";
  const [query, setQuery] = useState({ page: 1, status: "", revision: 0 });
  const [result, setResult] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback((page?: number, status?: string) => {
    setResult(null);
    setError("");
    setLoading(true);
    setQuery((current) => ({ page: page ?? current.page, status: status ?? current.status,
      revision: current.revision + 1 }));
  }, []);

  useEffect(() => {
    if (roleLoading || !allowedRole) return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    const search = new URLSearchParams({ page: String(query.page) });
    if (query.status) search.set("status", query.status);
    apiRequest<Roster>(`/events/${eventId}/registrations?${search}`, {
      signal: controller.signal, cache: "no-store",
    }).then((data) => { if (active) setResult(data); })
      .catch((reason: unknown) => {
        if (active) setError(controller.signal.aborted ? "Loading timed out. Please try again."
          : reason instanceof Error ? reason.message : "Could not load event registrations.");
      }).finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [eventId, roleLoading, allowedRole, query]);

  useEffect(() => {
    if (roleLoading || !allowedRole) return;
    const check = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const interval = window.setInterval(check, 30000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [allowedRole, roleLoading, refresh]);

  // Never show the previous event's private roster while a route change loads.
  const visible = !loading && !error && result?.event.id === eventId ? result : null;
  return <AppShell actingRole={role}>
    <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
      <Link href={`/events/${eventId}`} className="text-sm text-primary hover:underline">← Back to event</Link>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Event registrations</h1>
        {allowedRole && visible && <>
          <h2 className="break-words text-xl font-medium">{visible.event.title || "Untitled event"}</h2>
          <p className="text-sm text-muted-foreground">{recordReference(visible.event, visible.event.event_datetime)} · {visible.event.status}</p>
          {visible.event.status === "Cancelled" && <p role="status">This event was cancelled. These registrations are retained for reference.</p>}
        </>}
      </header>
      {roleLoading ? <p role="status">Loading your account...</p> : !allowedRole
        ? <p role="alert">Only the event&apos;s Organiser and assigned Coordinator can view registrations.</p>
        : <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1 text-sm">
              <label htmlFor="registration-status">Registration status</label>
              <select id="registration-status" value={query.status} disabled={loading} onChange={(e) => refresh(1, e.target.value)}
                className="ml-3 rounded-md border border-input bg-background px-3 py-2 text-foreground">
                <option value="">All registrations</option>
                <option>Registered</option><option>Waitlisted</option><option>Withdrawn</option>
              </select>
            </div>
            <Button variant="outline" disabled={loading} onClick={() => refresh()}>Refresh registrations</Button>
          </div>
          <p className="text-sm text-muted-foreground">Refreshes when you return and every 30 seconds while this page is visible. Totals cover the whole event, regardless of the filter or page.</p>
          {loading && <p role="status">Loading registrations...</p>}
          {error && <div className="space-y-3">
            <p role="alert" className="text-destructive">{error}</p>
            <Button variant="outline" onClick={() => refresh()}>Try again</Button>
          </div>}
          {visible && <>
            <dl aria-label="Registration totals" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Registered", `${visible.counts.registered_count} / ${visible.capacity ?? "Not set"}`],
                ["Waitlisted", visible.counts.waitlisted_count],
                ["Withdrawn", visible.counts.withdrawn_count],
                ["Places remaining", visible.capacity === null ? "Capacity not set"
                  : Math.max(0, visible.capacity - visible.counts.registered_count)],
              ].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-card p-4">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-2xl font-semibold">{value}</dd>
              </div>)}
            </dl>
            <p className="text-sm text-muted-foreground">Waitlisted and withdrawn registrations do not occupy places. Waiting-list signup is not currently available.</p>
            {visible.registrations.length === 0 ? <p role="status" className="rounded-xl border border-border bg-card p-6">
              {query.status ? `No ${query.status.toLowerCase()} registrations on this page.`
                : query.page === 1 ? "No registrations yet. Attendees will appear here after signing up."
                  : "No registrations on this page. Use Previous to return to an earlier page."}
            </p> : <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Attendees registered for this event</caption>
                <thead className="bg-muted"><tr>
                  {["Attendee", "Reference", "Status", "Registered at", "Withdrawn at"].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}
                </tr></thead>
                <tbody>{visible.registrations.map((registration) => <tr key={registration.id} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 font-medium">{registration.attendee?.display_name || "Attendee unavailable"}</th>
                  <td className="px-4 py-3 font-mono">{registration.reference ?? "Reference unavailable"}</td>
                  <td className="px-4 py-3">{registration.status}</td>
                  <td className="px-4 py-3">{eventTime(registration.registered_at)}</td>
                  <td className="px-4 py-3">{registration.withdrawn_at ? eventTime(registration.withdrawn_at) : "—"}</td>
                </tr>)}</tbody>
              </table>
            </div>}
            <nav aria-label="Registration pages" className="flex items-center gap-3">
              <Button variant="outline" disabled={query.page === 1} onClick={() => refresh(query.page - 1)}>Previous</Button>
              <span>Page {query.page}</span>
              <Button variant="outline" disabled={!visible.has_more} onClick={() => refresh(query.page + 1)}>Next</Button>
            </nav>
          </>}
        </>}
    </div>
  </AppShell>;
}
