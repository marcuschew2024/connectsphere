"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    <section
      aria-labelledby="notifications-heading"
      className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
    >
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 id="notifications-heading" className="text-lg font-semibold tracking-tight">
            Notifications
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Decisions and updates on your requests.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={refresh}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      {loading && (
        <p role="status" className="p-6 text-sm text-muted-foreground">
          Loading notifications…
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="m-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {!loading && !error &&
        (notifications.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-medium text-foreground">No notifications yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Your Coordinator’s decisions will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 sm:px-6">
              <p role="status" className="text-xs text-muted-foreground">
                {page * pageSize + 1}–{Math.min((page + 1) * pageSize, notifications.length)} of{" "}
                {notifications.length} updates
              </p>
              {pageCount > 1 && (
                <nav aria-label="Notification pages" className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page + 1 >= pageCount}
                  >
                    Next
                  </Button>
                </nav>
              )}
            </div>
            <ul className="divide-y divide-border">
              {notifications.slice(page * pageSize, (page + 1) * pageSize).map((notification) => {
                const accepted = notification.notification_type === "event_approved";
                const rejected = notification.notification_type === "event_rejected";
                return (
                  <li key={notification.id} className="px-5 py-4 sm:px-6">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm",
                          accepted
                            ? "bg-emerald-500/10 text-emerald-600"
                            : rejected
                              ? "bg-destructive/10 text-destructive"
                              : "bg-amber-500/10 text-amber-600",
                        )}
                      >
                        {accepted ? "✓" : rejected ? "×" : "!"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <h3
                            className={cn(
                              "text-sm font-semibold",
                              accepted
                                ? "text-emerald-700 dark:text-emerald-400"
                                : rejected
                                  ? "text-destructive"
                                  : "text-amber-700 dark:text-amber-400",
                            )}
                          >
                            {accepted
                              ? "Request accepted"
                              : rejected
                                ? "Request rejected"
                                : notification.notification_type === "event_clarification"
                                  ? "Clarification requested"
                                  : "Request update"}
                          </h3>
                          <time
                            dateTime={notification.created_at}
                            className="text-xs text-muted-foreground"
                          >
                            {new Date(notification.created_at).toLocaleString([], {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </div>
                        {notification.event?.title && (
                          <p className="mt-1 truncate text-sm font-medium text-foreground">
                            {notification.event.title}
                          </p>
                        )}
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                          {notification.message}
                        </p>
                        <Link
                          href={`/events/${notification.event_id}`}
                          className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-primary hover:underline"
                        >
                          View request <span aria-hidden="true">→</span>
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ))}
    </section>
  );
}
