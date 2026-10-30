"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/api";
import { eventTime } from "@/lib/registrations";
import { Button } from "@/components/ui/button";

type Policy = { closes_at: string | null; can_edit: boolean };
function localTime(value: string | null) {
  return value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16) : "";
}

export default function EventWithdrawalPolicy({ eventId }: { eventId: string }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    let active = true;
    apiRequest<{ withdrawal_policy: Policy }>(`/events/${eventId}/withdrawal-policy`, {
      signal: controller.signal, cache: "no-store",
    }).then(({ withdrawal_policy: saved }) => {
      if (active) { setPolicy(saved); setDeadline(localTime(saved.closes_at)); }
    }).catch(() => { if (active) setError("Could not load withdrawal conditions. Please try again."); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [eventId, revision]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const result = await apiRequest<{ withdrawal_policy: Policy }>(`/events/${eventId}/withdrawal-policy`, {
        method: "PUT", body: JSON.stringify({ closes_at: deadline ? new Date(`${deadline}+08:00`).toISOString() : null }),
        signal: controller.signal,
      });
      setPolicy(result.withdrawal_policy);
      setNotice("Withdrawal conditions saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not confirm the change. Reload conditions before retrying.");
    } finally { window.clearTimeout(timeout); setBusy(false); }
  }
  return <section aria-labelledby="withdrawal-policy-heading" className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
    <h2 id="withdrawal-policy-heading" className="font-semibold">Withdrawal conditions</h2>
    <p className="text-sm text-muted-foreground">Set conditions before the first signup. They lock after anyone registers, including when that registration is later withdrawn.</p>
    {error && <div className="space-y-2"><p role="alert" className="text-destructive">{error}</p><Button variant="outline" disabled={busy} onClick={() => { setError(""); setRevision((value) => value + 1); }}>Reload conditions</Button></div>}
    {!policy && !error && <p role="status">Loading withdrawal conditions...</p>}
    {policy && (policy.can_edit ? <form onSubmit={save} className="space-y-4">
      <div className="space-y-2"><label htmlFor="withdrawal-deadline" className="block text-sm font-medium">Withdrawal deadline (Singapore time, optional)</label>
        <input id="withdrawal-deadline" type="datetime-local" value={deadline} disabled={busy} onChange={(event) => { setDeadline(event.target.value); setNotice(""); }} aria-describedby="withdrawal-deadline-help" className="w-full rounded-md border border-input bg-background px-3 py-2 sm:max-w-sm" />
        <p id="withdrawal-deadline-help" className="text-sm text-muted-foreground">Leave blank to allow withdrawal until the event starts. An earlier deadline closes withdrawal at that exact time.</p></div>
      <Button disabled={busy} type="submit">{busy ? "Saving..." : "Save withdrawal conditions"}</Button>
    </form> : <p className="text-sm">{policy.closes_at ? `Withdrawal closes ${eventTime(policy.closes_at)}, or when the event starts if earlier.` : "Withdrawal is allowed until the event starts."} Conditions are locked.</p>)}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
  </section>;
}
