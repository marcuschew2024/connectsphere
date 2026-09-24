"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";

type Notification = {
  id: number;
  event_id: string;
  notification_type: string;
  message: string;
  created_at: string;
  event?: { title: string | null } | null;
};

export default function OrganiserNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 4;
  const pageCount = Math.max(1, Math.ceil(notifications.length / pageSize));

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ notifications: Notification[] }>("/notifications", { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setNotifications(result.notifications);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : "Could not load notifications.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);

  function refresh() {
    setError("");
    setPage(0);
    setLoading(true);
    setAttempt((value) => value + 1);
  }

  return (
    <section aria-labelledby="notifications-heading" className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
        <div>
          <h2 id="notifications-heading" className="text-lg font-semibold">Notifications</h2>
          <p className="mt-1 text-xs text-slate-400">Decisions and updates on your requests.</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading}
          className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50">
          Refresh
        </button>
      </div>
      {loading && <p role="status" className="p-6 text-sm text-slate-400">Loading notifications…</p>}
      {error && <p role="alert" className="m-5 rounded-xl border border-red-700 p-4 text-sm text-red-200">{error}</p>}
      {!loading && !error && (notifications.length === 0
        ? <div className="px-6 py-12 text-center"><p className="font-medium text-slate-200">No notifications yet.</p><p className="mt-2 text-sm text-slate-400">Your Coordinator’s decisions will appear here.</p></div>
        : <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-3 sm:px-6">
            <p role="status" className="text-xs text-slate-400">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, notifications.length)} of {notifications.length} updates</p>
            {pageCount > 1 && <nav aria-label="Notification pages" className="flex items-center gap-2">
              <button type="button" onClick={() => setPage(page - 1)} disabled={page === 0} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-30">Previous</button>
              <button type="button" onClick={() => setPage(page + 1)} disabled={page + 1 >= pageCount} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-30">Next</button>
            </nav>}
          </div>
          <ul className="divide-y divide-white/10">
            {notifications.slice(page * pageSize, (page + 1) * pageSize).map((notification) => {
              const accepted = notification.notification_type === "event_approved";
              const rejected = notification.notification_type === "event_rejected";
              return <li key={notification.id} className="px-5 py-4 sm:px-6">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${accepted ? "bg-emerald-400/10 text-emerald-300" : rejected ? "bg-rose-400/10 text-rose-300" : "bg-amber-400/10 text-amber-200"}`}>{accepted ? "✓" : rejected ? "×" : "!"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <h3 className={`text-sm font-semibold ${accepted ? "text-emerald-200" : rejected ? "text-rose-200" : "text-amber-200"}`}>{accepted ? "Request accepted" : rejected ? "Request rejected" : notification.notification_type === "event_clarification" ? "Clarification requested" : "Request update"}</h3>
                      <time dateTime={notification.created_at} className="text-xs text-slate-500">{new Date(notification.created_at).toLocaleString([], {day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"})}</time>
                    </div>
                    {notification.event?.title && <p className="mt-1 truncate text-sm font-medium text-slate-200">{notification.event.title}</p>}
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-400">{notification.message}</p>
                    <Link href={`/events/${notification.event_id}`} className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-sky-200 hover:text-sky-100">View request <span aria-hidden="true">→</span></Link>
                  </div>
                </div>
              </li>;
            })}
          </ul>
        </>)}
    </section>
  );
}
