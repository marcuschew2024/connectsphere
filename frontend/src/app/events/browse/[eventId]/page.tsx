"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { eventTime, type Registration, type RegistrationOffer } from "@/lib/registrations";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

export default function RegisterEventPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [role, , roleLoading] = useActingRole();
  const [offer, setOffer] = useState<RegistrationOffer | null>(null);
  const [information, setInformation] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const informationInput = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (roleLoading || role !== "Attendee") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    let active = true;
    apiRequest<RegistrationOffer>(`/events/${eventId}/registration-offer`, { signal: controller.signal })
      .then((data) => { if (active) setOffer(data); })
      .catch((reason: unknown) => {
        if (active) setError(controller.signal.aborted ? "Loading timed out. Please try again."
          : reason instanceof Error ? reason.message : "Could not load this event.");
      }).finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [eventId, role, roleLoading, attempt]);

  function refresh() {
    setError(""); setLoading(true); setAttempt((value) => value + 1);
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!offer || busy) return;
    const correction = offer.event.registration_requirements?.trim() && !information.trim()
      ? "Provide the required registration information."
      : information.length > 4000 ? "Use at most 4,000 characters for registration information." : "";
    setFieldError(correction); setError("");
    if (correction) { informationInput.current?.focus(); return; }
    setBusy(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const result = await apiRequest<{ registration: Registration }>(`/events/${eventId}/registrations`, {
        method: "POST", body: JSON.stringify({ information }), signal: controller.signal,
      });
      setOffer({ ...offer, registration: result.registration });
      setInformation("");
    } catch (reason: unknown) {
      if (reason instanceof ApiError && reason.fields.information) {
        setFieldError(reason.fields.information); informationInput.current?.focus();
      } else {
        setError(reason instanceof ApiError ? reason.message
          : "Could not confirm your registration. Refresh registration before retrying.");
      }
    } finally { window.clearTimeout(timeout); setBusy(false); }
  }

  const registration = offer?.registration;
  return <AppShell actingRole={role}>
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
      <Link href="/events/browse" className="text-sm text-primary hover:underline">← Browse events</Link>
      {roleLoading ? <p role="status">Loading your account...</p> : role !== "Attendee"
        ? <p role="alert">Sign in with an Attendee account to register for events. <Link href="/login" className="text-primary underline">Sign in</Link></p>
        : <>
          {loading && <p role="status">Loading event...</p>}
          {error && <div className="space-y-3"><p role="alert" className="text-destructive">{error}</p><Button variant="outline" disabled={busy || loading} onClick={refresh}>Refresh registration</Button></div>}
          {!loading && offer && <>
            <header className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">{offer.event.category}</p>
              <h1 className="break-words text-3xl font-semibold tracking-tight">{offer.event.title}</h1>
              <p className="text-muted-foreground">{eventTime(offer.event.event_datetime)}</p>
              <p className="whitespace-pre-wrap break-words leading-relaxed">{offer.event.description}</p>
            </header>
            {registration ? <section aria-labelledby="receipt-heading" className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
              <h2 id="receipt-heading" className="text-xl font-semibold">{registration.status === "Registered" ? "Registration confirmed" : "Registration withdrawn"}</h2>
              <p role="status">{registration.status === "Registered" ? "Your place is booked. A confirmation is also available on Home under Registration confirmations." : "Your previous registration has been withdrawn."}</p>
              <dl className="space-y-3 text-sm">
                <div><dt className="text-muted-foreground">Registration reference</dt><dd className="break-all font-mono">{registration.id}</dd></div>
                <div><dt className="text-muted-foreground">Registered at</dt><dd>{eventTime(registration.registered_at)}</dd></div>
              </dl>
            </section> : <section aria-labelledby="signup-heading" className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <h2 id="signup-heading" className="text-xl font-semibold">Book your place</h2>
              {offer.unavailable_reason ? <p role="status" className="text-muted-foreground">{offer.unavailable_reason}</p> : <>
                <p className="text-sm text-muted-foreground">{offer.capacity.remaining} {offer.capacity.remaining === 1 ? "place" : "places"} remaining</p>
                <form onSubmit={register} noValidate className="space-y-4">
                  {offer.event.registration_requirements && <div id="registration-instructions" className="space-y-2 text-sm"><p className="font-medium">Registration requirements</p><p className="whitespace-pre-wrap break-words text-muted-foreground">{offer.event.registration_requirements}</p></div>}
                  <div className="space-y-2">
                    <label htmlFor="registration-information" className="block text-sm font-medium">Registration information{offer.event.registration_requirements?.trim() ? " (required)" : " (optional)"}</label>
                    <textarea id="registration-information" ref={informationInput} rows={4} maxLength={4000}
                      value={information} onChange={(event) => setInformation(event.target.value)}
                      required={!!offer.event.registration_requirements?.trim()} aria-invalid={!!fieldError}
                      aria-describedby={`information-hint${offer.event.registration_requirements ? " registration-instructions" : ""}${fieldError ? " information-error" : ""}`}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    <p id="information-hint" className="text-xs text-muted-foreground">Follow the organiser’s instructions above. Use at most 4,000 characters.</p>
                    {fieldError && <p id="information-error" role="alert" className="text-sm text-destructive">{fieldError}</p>}
                  </div>
                  <Button type="submit" disabled={busy}>{busy ? "Registering..." : "Register for event"}</Button>
                </form>
              </>}
            </section>}
          </>}
        </>}
    </div>
  </AppShell>;
}
