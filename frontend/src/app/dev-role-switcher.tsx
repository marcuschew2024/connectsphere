"use client";

import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";

type DemoUser = { id: number; display_name: string; role: string };
type Session = { user: DemoUser | null };

export default function DevRoleSwitcher({ onRoleChange, compact = false }: {
  onRoleChange?: (role: string | null, pending?: boolean) => void;
  compact?: boolean;
}) {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [user, setUser] = useState<DemoUser | null>(null);
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };

    Promise.all([
      apiRequest<{ users: DemoUser[] }>("/dev/users", options),
      apiRequest<Session>("/dev/session", options),
    ])
      .then(([list, session]) => {
        if (controller.signal.aborted) return;
        setUsers(list.users);
        setUser(session.user);
        onRoleChange?.(session.user?.role ?? null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        onRoleChange?.(null);
        if (error instanceof ApiError && error.status === 404) {
          setVisible(false);
        } else {
          setError(error instanceof Error ? error.message : "Could not load demo users.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });

    return () => controller.abort();
  }, [onRoleChange]);

  async function switchUser(userId: string) {
    setBusy(true);
    // Disable dependent actions until the API confirms the new identity.
    onRoleChange?.(null, true);
    setError("");
    setMessage("");
    try {
      const result = await apiRequest<Session>("/dev/session", {
        method: userId ? "POST" : "DELETE",
        // HTML select values are strings; the API expects a numeric user ID.
        body: userId ? JSON.stringify({ user_id: Number(userId) }) : undefined,
      });
      setUser(result.user);
      onRoleChange?.(result.user?.role ?? null);
    } catch (error) {
      setUser(null);
      onRoleChange?.(null);
      setError(error instanceof Error ? error.message : "Could not switch users.");
    } finally {
      setBusy(false);
    }
  }

  async function testAction() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await apiRequest<{ actor: DemoUser }>("/dev/actions/test", {
        method: "POST",
      });
      setUser(result.actor);
      onRoleChange?.(result.actor.role);
      setMessage(`Test action attributed to ${result.actor.display_name} (${result.actor.role}).`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not perform test action.");
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <section
      aria-label="Development role switcher"
      className={compact
        ? "grid w-full gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm sm:grid-cols-[1fr_auto] sm:items-center"
        : "w-full max-w-md space-y-4 rounded-2xl border border-amber-500/50 bg-card p-5 text-foreground shadow-sm"}
    >
      <div>
        <h2 className={compact ? "text-sm font-medium text-foreground" : "font-semibold text-amber-600 dark:text-amber-400"}>
          {compact ? "Role preview" : "Development role switcher"}
        </h2>
        <p className="mt-1 hidden text-xs text-muted-foreground sm:block">
          {compact ? "Choose a role to see its workspace." : "Choose a demo user to test the app. Temporary until real login is available."}
        </p>
      </div>
      <div>
        <label htmlFor="acting-user" className={compact ? "sr-only" : "mb-2 block text-sm text-muted-foreground"}>Act as</label>
        <select
          id="acting-user"
          value={user?.id ?? ""}
          disabled={busy || users.length === 0}
          onChange={(event) => void switchUser(event.target.value)}
          className="w-full rounded-lg border border-input bg-background p-2.5 text-sm text-foreground shadow-xs transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50 motion-reduce:transition-none"
        >
          <option value="">Select a demo user</option>
          {users.map((demoUser) => (
            <option key={demoUser.id} value={demoUser.id}>
              {demoUser.display_name} — {demoUser.role}
            </option>
          ))}
        </select>
      </div>
      <p className={compact ? "sr-only" : "text-sm text-muted-foreground"} aria-live="polite">
        {user ? `Acting as: ${user.display_name} (${user.role})` : "No acting user selected."}
      </p>
      {!compact && <button
        type="button"
        disabled={busy || !user}
        onClick={() => void testAction()}
        className="rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 disabled:opacity-50"
      >
        Test action
      </button>}
      {message && <p role="status" className="text-sm text-emerald-600 sm:col-span-full">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive sm:col-span-full">{error}</p>}
    </section>
  );
}
