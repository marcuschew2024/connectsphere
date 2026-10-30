"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { eventTime } from "@/lib/registrations";
import { Button } from "@/components/ui/button";

type Confirmation = {
  id: number;
  event_id: string;
  notification_type?: string;
  message: string;
  created_at: string;
  event: { title: string | null } | null;
};

export default function RegistrationConfirmations() {
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    apiRequest<{ confirmations: Confirmation[] }>("/events/registration-confirmations", {
      signal: controller.signal,
    }).then((data) => { if (active) setConfirmations(data.confirmations); })
      .catch((reason: unknown) => {
        if (active) setError(controller.signal.aborted ? "Loading timed out. Please try again."
          : reason instanceof Error ? reason.message : "Could not load registration confirmations.");
      }).finally(() => { window.clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [attempt]);

  return <section aria-labelledby="registration-confirmations-heading" className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
    <div className="flex items-center justify-between gap-3 border-b border-border p-5">
      <div><h2 id="registration-confirmations-heading" className="text-lg font-semibold">Registration confirmations</h2>
        <p className="mt-1 text-xs text-muted-foreground">Your latest 50 signup and withdrawal confirmations.</p></div>
      <Button variant="outline" size="sm" disabled={loading} onClick={() => {
        setError(""); setLoading(true); setAttempt((value) => value + 1);
      }}>Refresh confirmations</Button>
    </div>
    {loading && <p role="status" className="p-5 text-sm text-muted-foreground">Loading confirmations...</p>}
    {error && <p role="alert" className="p-5 text-sm text-destructive">{error}</p>}
    {!loading && !error && (confirmations.length === 0
      ? <p className="p-5 text-sm text-muted-foreground">Your registration confirmations will appear here.</p>
      : <ul className="divide-y divide-border">{confirmations.map((confirmation) => <li key={confirmation.id} className="space-y-2 p-5">
        <h3 className="font-semibold">{confirmation.notification_type === "registration_withdrawn" ? "Registration withdrawn" : "Registration confirmed"}</h3>
        <p className="break-words text-sm font-medium">{confirmation.event?.title}</p>
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{confirmation.message}</p>
        <p className="text-xs text-muted-foreground">{eventTime(confirmation.created_at)}</p>
        <Link href={`/events/browse/${confirmation.event_id}`} className="inline-flex text-sm text-primary hover:underline">View event →</Link>
      </li>)}</ul>)}
  </section>;
}
