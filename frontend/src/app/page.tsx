"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  CalendarPlus,
  ClipboardCheck,
  FileText,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import DevRoleSwitcher from "./dev-role-switcher";
import OrganiserNotifications from "./organiser-notifications";

type Action = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  primary?: boolean;
};

const ROLE_ACTIONS: Record<string, Action[]> = {
  Organiser: [
    { title: "Create an event request", description: "Start a new request for approval.", href: "/events/new", icon: Plus, primary: true },
    { title: "My drafts", description: "Pick up a private draft where you left off.", href: "/events/drafts", icon: FileText },
  ],
  Coordinator: [
    { title: "Review event requests", description: "Approve, reject or return submissions.", href: "/events/review", icon: ClipboardCheck, primary: true },
    { title: "Venue catalogue", description: "Browse venues for an event.", href: "/venues", icon: Building2 },
    { title: "Request a venue", description: "Submit timing and requirements to Venue Staff.", href: "/venues/bookings/new", icon: CalendarPlus },
  ],
  "Venue Staff": [
    { title: "Add a venue", description: "List a new venue in the catalogue.", href: "/venues/new", icon: Plus, primary: true },
    { title: "Venue catalogue", description: "Browse and manage venues.", href: "/venues", icon: Building2 },
    { title: "Venue booking requests", description: "Review requests submitted by Coordinators.", href: "/venues/bookings", icon: ClipboardCheck },
  ],
};

function ActionTile({ action }: { action: Action }) {
  const { title, description, href, icon: Icon, primary } = action;
  return (
    <Link
      href={href}
      aria-label={title}
      className="group relative flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span
        className={cn(
          "inline-flex size-11 items-center justify-center rounded-xl transition-colors",
          primary ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <h3 className="flex items-center gap-1 font-medium tracking-tight">
          {title}
          <ArrowUpRight
            className="size-4 -translate-x-1 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}

export default function Home() {
  const [actingRole, updateRole] = useActingRole();

  const actions = actingRole ? ROLE_ACTIONS[actingRole] : undefined;

  return (
    <AppShell actingRole={actingRole}>
      <div className="relative">
        {/* Subtle blue glow at the top of the content area for depth. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 bg-gradient-to-b from-primary/[0.06] to-transparent"
        />

        <div className="mx-auto max-w-6xl space-y-10 px-5 py-10 sm:px-8 sm:py-14">
          {/* Page-level h1 for accessibility (the visible wordmark lives in the sidebar). */}
          <h1 className="sr-only">ConnectSphere</h1>
          <div className="max-w-2xl">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-primary">
              {actingRole ? `${actingRole} workspace` : "Overview"}
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {actingRole ? `You’re in ${actingRole} view` : "Your workspace, all in one place"}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              {actingRole === "Organiser"
                ? "Start a request, continue a draft or catch up on decisions."
                : actingRole === "Coordinator"
                  ? "Review the requests assigned to you and keep events moving."
                  : "Manage the full event lifecycle — requests, coordination, venues and bookings."}
            </p>
          </div>

          {process.env.NODE_ENV === "development" && (
            <DevRoleSwitcher compact onRoleChange={updateRole} />
          )}

          {actions && (
            <section aria-label="Quick actions">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {actions.map((action) => (
                  <ActionTile key={action.href + action.title} action={action} />
                ))}
              </div>
            </section>
          )}

          {actingRole === "Organiser" && <OrganiserNotifications />}

          {actingRole && !actions && (
            <div className="rounded-2xl border border-border/80 bg-card p-6 text-sm text-muted-foreground shadow-sm">
              No actions are available for the {actingRole} role yet — {actingRole} tools arrive in a
              later sprint.
            </div>
          )}

          {!actingRole && (
            <div className="rounded-2xl border border-border/80 bg-card p-6 text-sm text-muted-foreground shadow-sm">
              {process.env.NODE_ENV === "development"
                ? "Select a role above to see what it can do."
                : "Sign in to access your workspace."}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
