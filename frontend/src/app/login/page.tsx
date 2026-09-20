"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiRequest } from "@/lib/api";

type User = { id: number; display_name: string; role: string };

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError("");

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    setBusy(true);
    try {
      await apiRequest<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push("/");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError("Account temporarily locked due to too many failed attempts. Please try again later.");
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Could not reach the server. Check your connection.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-3xl font-bold tracking-tight">ConnectSphere</h1>
          <p className="text-sm text-slate-400">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-6">
          {error && (
            <p role="alert" className="rounded border border-red-700 bg-red-950/40 p-3 text-sm text-red-200">
              {error}
            </p>
          )}

          <div className="space-y-1">
            <label htmlFor="email" className="block text-sm font-medium">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              disabled={busy}
              className="w-full rounded border border-slate-600 bg-slate-950 p-2.5 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400 disabled:opacity-50"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="block text-sm font-medium">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={busy}
              className="w-full rounded border border-slate-600 bg-slate-950 p-2.5 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400 disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-sky-300 py-2.5 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
