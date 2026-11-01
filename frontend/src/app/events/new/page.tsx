"use client";

import Link from "next/link";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import DevRoleSwitcher from "../../dev-role-switcher";
import EventRequestForm from "./event-request-form";

export default function NewEventPage() {
  const [actingRole, updateRole, loading] = useActingRole();
  const canCreate = actingRole === "Organiser" && !loading;
  return (
    <AppShell actingRole={actingRole}>
      <div className="mx-auto max-w-4xl space-y-7 px-5 py-8 sm:px-8 sm:py-10">
        {canCreate && <Link href="/events/mine" className="inline-flex text-sm text-primary hover:underline">← Back to my requests</Link>}
        <header className="space-y-3 pb-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Event requests</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Create an event request</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">Tell us what you want to organise. Save an idea privately, or submit it for a Coordinator to review and arrange.</p>
        </header>
        {canCreate && <ol aria-label="Request process" className="grid gap-4 rounded-2xl border border-border bg-muted/30 p-5 sm:grid-cols-3">
          {[
            ["Describe your event", "Add the essentials and any requirements."],
            ["Submit for review", "The Lead assigns a Coordinator to your request."],
            ["Track your request", "Follow decisions and arrangements in My requests."],
          ].map(([title, description], index) => <li key={title} className="flex gap-3">
            <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
            <div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></div>
          </li>)}
        </ol>}
        {process.env.NODE_ENV === "development" && <DevRoleSwitcher compact onRoleChange={updateRole} />}

        <div>
          <div className="role-panel" data-visible={!canCreate} aria-hidden={canCreate} inert={canCreate}>
            <div className="role-panel-content">
              <section role="status" className="rounded-2xl border border-border bg-card px-6 py-9 text-center shadow-sm sm:px-10 sm:py-11">
                <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="16" rx="3" />
                    <path d="M8 3v4M16 3v4M4 11h16M9 16h6M12 13v6" strokeLinecap="round" />
                  </svg>
                </div>
                <h2 className="text-xl font-medium tracking-tight">
                  {loading ? "Getting your workspace ready…" : actingRole ? `You’re in ${actingRole} view` : "Choose a role to get started"}
                </h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  {loading ? "Your selected role will appear in a moment." : "Event creation is available to Organisers."}
                </p>
                {!loading && process.env.NODE_ENV === "development" && (
                  <p className="mt-4 text-sm text-muted-foreground">Select <span className="font-medium text-primary">Organiser</span> above to start a request.</p>
                )}
                {!loading && (
                  <Link href="/" className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted motion-reduce:transition-none">
                    Back to overview <span aria-hidden="true">→</span>
                  </Link>
                )}
              </section>
            </div>
          </div>

          {/* Keep the form mounted so switching roles does not erase unsaved input.
              Hidden content is inert and excluded from keyboard/screen-reader access. */}
          <div className="role-panel" data-visible={canCreate} aria-hidden={!canCreate} inert={!canCreate}>
            <div className="role-panel-content">
              <EventRequestForm canCreate={canCreate} />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
