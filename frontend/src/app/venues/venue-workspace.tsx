"use client";

import type { ReactNode } from "react";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import DevRoleSwitcher from "../dev-role-switcher";

export default function VenueWorkspace({
  title,
  description,
  creating = false,
  editing = false,
  children,
}: {
  title: string;
  description: string;
  creating?: boolean;
  editing?: boolean;
  children: (role: string) => ReactNode;
}) {
  const [role, updateRole, loading] = useActingRole();
  const allowed = !loading && (role === "Venue Staff" || (!creating && !editing && role === "Coordinator"));

  return (
    <AppShell actingRole={role}>
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
        <header>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Venues</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </header>
        {process.env.NODE_ENV === "development" && (
          <DevRoleSwitcher compact onRoleChange={updateRole} />
        )}
        {allowed ? (
          children(role!)
        ) : (
          <section
            role="status"
            className="rounded-2xl border border-border bg-card p-7 text-sm text-muted-foreground shadow-sm"
          >
            {loading
              ? "Checking access…"
              : !role
                ? "Sign in or select a demo user to continue."
                : editing
                  ? "Only Venue Staff can edit a venue."
                : creating
                  ? "Only Venue Staff can add a venue."
                  : "The venue catalogue is available to Venue Staff and Coordinators."}
          </section>
        )}
      </div>
    </AppShell>
  );
}
