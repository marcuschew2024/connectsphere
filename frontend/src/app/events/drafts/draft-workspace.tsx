"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import DevRoleSwitcher from "../../dev-role-switcher";

export default function DraftWorkspace({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const [role, updateRole, loading] = useActingRole();
  const [identityVersion, setIdentityVersion] = useState(0);
  const onRoleChange = useCallback((nextRole: string | null, pending = false) => {
    updateRole(nextRole, pending);
    // Changing from Organiser A to Organiser B must also clear private data.
    // A new key remounts the content and cancels its previous requests.
    setIdentityVersion((version) => version + 1);
  }, [updateRole]);

  return (
    <AppShell actingRole={role}>
      <div className="mx-auto max-w-4xl space-y-8 px-5 py-8 sm:px-8 sm:py-10">
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Your workspace</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground">{description}</p>
        </header>

        {process.env.NODE_ENV === "development" && <DevRoleSwitcher compact onRoleChange={onRoleChange} />}

        {!loading && role === "Organiser" ? (
          <div key={identityVersion} className="draft-reveal">{children}</div>
        ) : (
          <section role="status" className="rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm">
            <h2 className="text-xl font-medium">{loading ? "Getting your workspace ready…" : "A private space for Organisers"}</h2>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {loading ? "Your drafts will appear in a moment." : "Draft requests are available only to the Organiser who created them."}
            </p>
            {!loading && process.env.NODE_ENV === "development" && <p className="mt-5 text-sm text-primary">Select an Organiser above to continue.</p>}
          </section>
        )}
      </div>
    </AppShell>
  );
}
