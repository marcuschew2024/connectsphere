"use client";

import { useEffect, useState } from "react";

const ROLES = [
  "Event Organiser",
  "Coordinator",
  "Venue Staff",
  "Technical Support",
  "Attendee",
];

type ApiStatus = "checking" | "ok" | "unreachable";

export default function Home() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";
    const controller = new AbortController();

    fetch(`${apiUrl}/health`, { signal: controller.signal })
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

      <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm">
        <span className={`h-2.5 w-2.5 rounded-full ${statusColor}`} />
        <span>API: {statusLabel}</span>
      </div>
    </main>
  );
}
