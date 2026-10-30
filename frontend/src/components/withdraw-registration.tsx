"use client";

import { useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { Registration } from "@/lib/registrations";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export default function WithdrawRegistration({ eventId, onWithdrawn }: {
  eventId: string; onWithdrawn: (registration: Registration) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const submitting = useRef(false);
  async function withdraw() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const result = await apiRequest<{ registration: Registration }>(`/events/${eventId}/registrations/withdraw`, {
        method: "POST", body: "{}", signal: controller.signal,
      });
      if (result.registration.status !== "Withdrawn") throw new Error("Withdrawal was not confirmed. Refresh registration to check your current status.");
      setOpen(false); onWithdrawn(result.registration);
    } catch (reason) {
      setUncertain(true);
      setError(reason instanceof Error ? reason.message : "Withdrawal was not confirmed. Refresh registration to check your current status.");
    } finally { window.clearTimeout(timeout); submitting.current = false; setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
    <DialogTrigger asChild><Button variant="outline">Withdraw registration</Button></DialogTrigger>
    <DialogContent showCloseButton={!busy} onOpenAutoFocus={(event) => {
      event.preventDefault(); document.getElementById("keep-registration")?.focus();
    }}>
      <DialogTitle>Withdraw your registration?</DialogTitle>
      <DialogDescription>Your place will be released. You cannot undo this withdrawal or register again for this event.</DialogDescription>
      {error && <p role="alert" className="text-destructive">{error} Close this dialog and refresh registration before trying again.</p>}
      <div className="flex flex-wrap gap-3">
        <Button id="keep-registration" variant="outline" disabled={busy} onClick={() => setOpen(false)}>{uncertain ? "Close" : "Keep registration"}</Button>
        <Button disabled={busy || uncertain} onClick={withdraw}>{busy ? "Withdrawing..." : "Confirm withdrawal"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
