"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { useActingRole } from "@/lib/use-acting-role";
import DevRoleSwitcher from "../dev-role-switcher";

export default function EquipmentWorkspace({
  title,
  description,
  editing = false,
  requesting = false,
  children,
}: {
  title: string;
  description: string;
  editing?: boolean;
  requesting?: boolean;
  children: (role: string) => ReactNode;
}) {
  const [role, updateRole, loading] = useActingRole();
  const allowed = !loading && (requesting ? role === "Coordinator"
    : role === "Tech Support" || (!editing && role === "Coordinator"));

  return (
    <AppShell actingRole={role}>
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8 sm:py-10">
        <header>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Equipment</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        </header>
        {process.env.NODE_ENV === "development" && (
          <DevRoleSwitcher compact onRoleChange={updateRole} />
        )}
        {allowed ? children(role!) : (
          <p role="status" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            {loading ? "Checking access…" : !role
              ? "Sign in or select a demo user to continue."
              : requesting ? "Only Coordinators can request equipment."
              : editing ? "Only Tech Support can maintain equipment."
              : "The equipment catalogue is available to Tech Support and Coordinators."}
          </p>
        )}
      </div>
    </AppShell>
  );
}
