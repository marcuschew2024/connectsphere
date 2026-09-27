"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus } from "lucide-react";
import { API_URL, apiRequest } from "@/lib/api";
import { useActingRole } from "@/lib/use-acting-role";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
      ? "checking…"
      : apiStatus === "ok"
        ? "ok"
        : "unreachable";

  const statusColor =
    apiStatus === "ok"
      ? "bg-emerald-500"
      : apiStatus === "unreachable"
        ? "bg-destructive"
        : "bg-amber-500";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              ConnectSphere<span aria-hidden="true" className="text-primary">.</span>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">Your event workspace</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", statusColor)} />
              API: {statusLabel}
            </span>
            {actingRole && (
              <Button type="button" variant="outline" size="sm" onClick={handleLogout}>
                Sign out
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-5 py-7 sm:px-8 sm:py-9">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-primary">
              Overview
            </p>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {actingRole ? `You’re in ${actingRole} view` : "Your workspace"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {actingRole === "Organiser"
                ? "Start a request, continue a draft or catch up on decisions."
                : actingRole === "Coordinator"
                  ? "Review the requests assigned to you and keep events moving."
                  : "Manage your events in one place."}
            </p>
          </div>
        </div>

        {process.env.NODE_ENV === "development" && (
          <DevRoleSwitcher compact onRoleChange={updateRole} />
        )}

        <div
          className={cn(
            "grid items-start gap-6",
            actingRole === "Organiser" && "lg:grid-cols-[280px_minmax(0,1fr)]",
          )}
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {actingRole ? "Your next step" : "Get started"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {actingRole === "Organiser" && (
                <>
                  <Button asChild className="w-full justify-between">
                    <Link href="/events/new">
                      Create an event request <Plus className="size-4" aria-hidden="true" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full justify-between">
                    <Link href="/events/drafts">
                      My drafts <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </Button>
                  <p className="hidden pt-1 text-xs leading-relaxed text-muted-foreground lg:block">
                    Drafts are private. Once submitted, your Coordinator reviews your request
                    and the decision appears in Notifications.
                  </p>
                </>
              )}
              {actingRole === "Coordinator" && (
                <Button asChild className="justify-between">
                  <Link href="/events/review">
                    Review event requests <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              )}
              {(actingRole === "Venue Staff" || actingRole === "Coordinator") && (
                <div className="flex flex-wrap gap-3">
                  {actingRole === "Venue Staff" && (
                    <Button asChild>
                      <Link href="/venues/new">Add a venue</Link>
                    </Button>
                  )}
                  <Button asChild variant="outline">
                    <Link href="/venues">Venue catalogue</Link>
                  </Button>
                </div>
              )}
              {actingRole &&
                !["Organiser", "Coordinator", "Venue Staff"].includes(actingRole) && (
                  <p className="text-sm text-muted-foreground">
                    No actions are available for the {actingRole} role yet — {actingRole} tools
                    arrive in a later sprint.
                  </p>
                )}
              {!actingRole && (
                <p className="text-sm text-muted-foreground">
                  {process.env.NODE_ENV === "development"
                    ? "Select a role above to see what it can do."
                    : "Sign in to access your workspace."}
                </p>
              )}
            </CardContent>
          </Card>
          {actingRole === "Organiser" && <OrganiserNotifications />}
        </div>
      </div>
    </main>
  );
}
