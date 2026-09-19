"use client";

import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";

type DemoUser = { id: number; display_name: string; role: string };
type Session = { user: DemoUser | null };

export default function DevRoleSwitcher() {
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
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
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
  }, []);

  async function switchUser(userId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await apiRequest<Session>("/dev/session", {
        method: userId ? "POST" : "DELETE",
        // HTML select values are strings; the API expects a numeric user ID.
        body: userId ? JSON.stringify({ user_id: Number(userId) }) : undefined,
      });
      setUser(result.user);
    } catch (error) {
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
      className="w-full max-w-md space-y-4 rounded-lg border border-amber-700 bg-slate-900 p-5"
    >
      <div>
        <h2 className="font-semibold text-amber-300">Development role switcher</h2>
        <p className="mt-1 text-sm text-slate-400">
          Choose a demo user to test the app. Temporary until real login is available.
        </p>
      </div>
      <div>
        <label htmlFor="acting-user" className="mb-2 block text-sm">Act as</label>
        <select
          id="acting-user"
          value={user?.id ?? ""}
          disabled={busy || users.length === 0}
          onChange={(event) => void switchUser(event.target.value)}
          className="w-full rounded border border-slate-600 bg-slate-950 p-2 disabled:opacity-50"
        >
          <option value="">Select a demo user</option>
          {users.map((demoUser) => (
            <option key={demoUser.id} value={demoUser.id}>
              {demoUser.display_name} — {demoUser.role}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm" aria-live="polite">
        {user ? `Acting as: ${user.display_name} (${user.role})` : "No acting user selected."}
      </p>
      <button
        type="button"
        disabled={busy || !user}
        onClick={() => void testAction()}
        className="rounded bg-amber-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
      >
        Test action
      </button>
      {message && <p role="status" className="text-sm text-green-300">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    </section>
  );
}
