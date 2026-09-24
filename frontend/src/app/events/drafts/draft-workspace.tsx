"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { useActingRole } from "@/lib/use-acting-role";
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
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-slate-100 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-4xl space-y-8 sm:space-y-10">
        <nav aria-label="Draft navigation" className="flex items-center justify-between text-sm">
          <Link href="/" className="text-slate-400 transition-colors hover:text-white motion-reduce:transition-none">← ConnectSphere</Link>
          {role === "Organiser" && <Link href="/events/drafts" className="text-slate-300 hover:text-white">My drafts</Link>}
        </nav>
        <header className="space-y-4">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-sky-300">Your workspace</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
          <p className="max-w-xl text-base leading-relaxed text-slate-400">{description}</p>
        </header>

        {process.env.NODE_ENV === "development" && <DevRoleSwitcher compact onRoleChange={onRoleChange} />}

        {!loading && role === "Organiser" ? (
          <div key={identityVersion} className="draft-reveal">{children}</div>
        ) : (
          <section role="status" className="rounded-3xl border border-white/10 bg-white/[0.02] px-6 py-14 text-center">
            <h2 className="text-xl font-medium">{loading ? "Getting your workspace ready…" : "A private space for Organisers"}</h2>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
              {loading ? "Your drafts will appear in a moment." : "Draft requests are available only to the Organiser who created them."}
            </p>
            {!loading && process.env.NODE_ENV === "development" && <p className="mt-5 text-sm text-sky-200">Select an Organiser above to continue.</p>}
          </section>
        )}
      </div>
    </main>
  );
}
