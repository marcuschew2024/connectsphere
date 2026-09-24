"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { API_URL, apiRequest } from "@/lib/api";
import { useActingRole } from "@/lib/use-acting-role";
import DevRoleSwitcher from "./dev-role-switcher";
import OrganiserNotifications from "./organiser-notifications";

type ApiStatus = "checking" | "ok" | "unreachable";

export default function Home() {
  const router = useRouter();
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [actingRole, updateRole] = useActingRole();

  async function handleLogout() {
    await apiRequest("/auth/logout", { method: "POST" }).catch(() => {});
    updateRole(null);
    router.push("/login");
  }

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then((data: { status?: string }) => {
        setApiStatus(data.status === "ok" ? "ok" : "unreachable");
      })
      .catch(() => {
        setApiStatus("unreachable");
      });

    return () => controller.abort();
  }, []);

  const statusLabel =
    apiStatus === "checking"
      ? "checking..."
      : apiStatus === "ok"
        ? "ok"
        : "unreachable";

  const statusColor =
    apiStatus === "ok"
      ? "bg-green-500"
      : apiStatus === "unreachable"
        ? "bg-red-500"
        : "bg-yellow-500";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-white/10 bg-slate-900/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">ConnectSphere<span aria-hidden="true" className="text-sky-300">.</span></h1>
            <p className="mt-1 text-xs text-slate-400">Your event workspace</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 text-xs text-slate-400">
              <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />API: {statusLabel}
            </span>
            {actingRole && <button type="button" onClick={handleLogout} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5">Sign out</button>}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-5 py-7 sm:px-8 sm:py-9">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-sky-300">Overview</p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{actingRole ? `You’re in ${actingRole} view` : "Your workspace"}</h2>
            <p className="mt-2 text-sm text-slate-400">{actingRole === "Organiser" ? "Start a request, continue a draft or catch up on decisions." : actingRole === "Coordinator" ? "Review the requests assigned to you and keep events moving." : "Manage your events in one place."}</p>
          </div>
        </div>

        {process.env.NODE_ENV === "development" && <DevRoleSwitcher compact onRoleChange={updateRole} />}

        <div className={`grid items-start gap-6 ${actingRole === "Organiser" ? "lg:grid-cols-[280px_minmax(0,1fr)]" : ""}`}>
          <section aria-label="Workspace actions" className="rounded-2xl border border-white/10 bg-slate-900/50 p-5 sm:p-6">
            <h3 className="mb-4 text-sm font-medium text-slate-300">{actingRole ? "Your next step" : "Get started"}</h3>
            {actingRole === "Organiser" && <div className="space-y-3">
              <Link href="/events/new" className="flex items-center justify-between gap-3 rounded-xl bg-sky-300 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-200">Create an event request <span aria-hidden="true">＋</span></Link>
              <Link href="/events/drafts" className="flex items-center justify-between rounded-xl border border-white/15 px-4 py-3 text-sm font-medium text-slate-200 hover:bg-white/5">My drafts <span aria-hidden="true">→</span></Link>
              <p className="hidden pt-1 text-xs leading-relaxed text-slate-400 lg:block">Drafts are private. Once submitted, your Coordinator reviews your request and the decision appears in Notifications.</p>
            </div>}
            {actingRole === "Coordinator" && <Link href="/events/review" className="inline-flex items-center gap-6 rounded-xl bg-sky-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-200">Review event requests <span aria-hidden="true">→</span></Link>}
            {(actingRole === "Venue Staff" || actingRole === "Coordinator") && <div className="mt-3 flex flex-wrap gap-3">
              {actingRole === "Venue Staff" && <Link href="/venues/new" className="rounded-xl bg-sky-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-200">Add a venue</Link>}
              <Link href="/venues" className="rounded-xl border border-white/15 px-5 py-3 text-sm font-medium text-sky-200 hover:bg-white/5">Venue catalogue</Link>
            </div>}
            {actingRole && !["Organiser", "Coordinator", "Venue Staff"].includes(actingRole) && <p className="text-sm text-slate-400">No actions are available for the {actingRole} role yet — {actingRole} tools arrive in a later sprint.</p>}
            {!actingRole && <p className="text-sm text-slate-400">{process.env.NODE_ENV === "development" ? "Select a role above to see what it can do." : "Sign in to access your workspace."}</p>}
          </section>
          {actingRole === "Organiser" && <OrganiserNotifications />}
        </div>
      </div>
    </main>
  );
}
