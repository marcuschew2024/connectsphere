"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useActingRole } from "@/lib/use-acting-role";
import DevRoleSwitcher from "../dev-role-switcher";

export default function VenueWorkspace({ title, description, creating = false, children }: {
  title: string; description: string; creating?: boolean; children: (role: string) => ReactNode;
}) {
  const [role, updateRole, loading] = useActingRole();
  const allowed = !loading && (role === "Venue Staff" || (!creating && role === "Coordinator"));
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav aria-label="Venue navigation" className="border-b border-white/10 bg-slate-900/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <Link href="/" className="text-sm text-slate-300 hover:text-white">← Back to workspace</Link>
          {creating && <Link href="/venues" className="rounded-lg border border-white/15 px-3 py-2 text-sm text-sky-200 hover:bg-white/5">Venue catalogue</Link>}
        </div>
      </nav>
      <div className="mx-auto max-w-6xl space-y-6 px-5 py-7 sm:px-8 sm:py-9">
        <header>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-sky-300">Venues</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{description}</p>
        </header>
        {process.env.NODE_ENV === "development" && <DevRoleSwitcher compact onRoleChange={updateRole} />}
        {allowed ? children(role!) : <section role="status" className="rounded-2xl border border-white/10 bg-slate-900/50 p-7 text-sm text-slate-300">
          {loading ? "Checking access…" : !role ? "Sign in or select a demo user to continue." : creating ? "Only Venue Staff can add a venue." : "The venue catalogue is available to Venue Staff and Coordinators."}
        </section>}
      </div>
    </main>
  );
}
