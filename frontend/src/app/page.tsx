"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { API_URL, apiRequest } from "@/lib/api";
import { useActingRole } from "@/lib/use-acting-role";
import DevRoleSwitcher from "./dev-role-switcher";

const ROLES = [
  "Organiser",
  "Coordinator",
  "Venue Staff",
  "Tech Support",
  "Attendee",
];

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
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 bg-slate-950 p-8 text-slate-100">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-5xl font-bold tracking-tight">ConnectSphere</h1>
        <p className="max-w-xl text-slate-400">
          An event lifecycle management platform: request, coordination,
          venue and equipment booking, and attendee registration. Walking-skeleton scaffold.
        </p>
      </div>

      <section className="w-full max-w-md">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Roles
        </h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ROLES.map((role) => (
            <li
              key={role}
              className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm"
            >
              {role}
            </li>
          ))}
        </ul>
      </section>

      {process.env.NODE_ENV === "development" && <DevRoleSwitcher onRoleChange={updateRole} />}

      <div className="space-y-2 text-center">
        {actingRole === "Organiser" ? (
          <Link href="/events/new" className="inline-block rounded bg-sky-300 px-5 py-3 font-semibold text-slate-950">
            Create an event request
          </Link>
        ) : (
          <button type="button" disabled aria-describedby="create-event-help"
            className="cursor-not-allowed rounded bg-sky-300 px-5 py-3 font-semibold text-slate-950 opacity-40">
            Create an event request
          </button>
        )}
        {actingRole !== "Organiser" && (
          <p id="create-event-help" className="text-sm text-slate-400">Only Organisers can create event requests.</p>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm">
        <span className={`h-2.5 w-2.5 rounded-full ${statusColor}`} />
        <span>API: {statusLabel}</span>
      </div>

      {actingRole && (
        <button
          type="button"
          onClick={handleLogout}
          className="text-sm text-slate-400 underline hover:text-white"
        >
          Sign out
        </button>
      )}
    </main>
  );
}
