"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Building2,
  CalendarPlus,
  ClipboardCheck,
  FileText,
  Package,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { useActingRole } from "@/lib/use-acting-role";
import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import DevRoleSwitcher from "./dev-role-switcher";
import NotificationsFeed from "./notifications-feed";
import RegistrationConfirmations from "./registration-confirmations";

type Action = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  primary?: boolean;
};

const ROLE_ACTIONS: Record<string, Action[]> = {
  Attendee: [
    { title: "Browse events", description: "Find a campus event and book your place.", href: "/events/browse", icon: CalendarPlus, primary: true },
    { title: "My registrations", description: "Check your current registration status.", href: "/registrations", icon: ClipboardCheck },
  ],
  "Safety Officer": [
    { title: "Review operational safety", description: "Assess confirmed events before preparation.", href: "/events/safety", icon: ClipboardCheck, primary: true },
  ],
  "Event Coordinator Lead": [
    { title: "Supervised events", description: "Oversee intake and every Coordinator's assignments.", href: "/events/supervised", icon: ClipboardCheck, primary: true },
  ],
  Organiser: [
    { title: "Create an event request", description: "Start a new request for approval.", href: "/events/new", icon: Plus, primary: true },
    { title: "My drafts", description: "Pick up a private draft where you left off.", href: "/events/drafts", icon: FileText },
  ],
  Coordinator: [
    { title: "Review event requests", description: "Approve, reject or return submissions.", href: "/events/review", icon: ClipboardCheck, primary: true },
    { title: "Manage events", description: "Continue planning, confirm or close an assigned event.", href: "/events/managed", icon: FileText },
    { title: "Venue catalogue", description: "Browse venues for an event.", href: "/venues", icon: Building2 },
    { title: "Request a venue", description: "Submit timing and requirements to Venue Staff.", href: "/venues/bookings/new", icon: CalendarPlus },
    { title: "Equipment catalogue", description: "Browse equipment and usable stock.", href: "/equipment", icon: Package },
    { title: "Request equipment", description: "Send event requirements to Tech Support.", href: "/equipment/requests/new", icon: Plus },
  ],
  "Venue Staff": [
    { title: "Add a venue", description: "List a new venue in the catalogue.", href: "/venues/new", icon: Plus, primary: true },
    { title: "Venue catalogue", description: "Browse and manage venues.", href: "/venues", icon: Building2 },
    { title: "Venue booking requests", description: "Review requests submitted by Coordinators.", href: "/venues/bookings", icon: ClipboardCheck },
  ],
  "Tech Support": [
    { title: "Equipment catalogue", description: "Manage equipment, quantities and condition.", href: "/equipment", icon: Package, primary: true },
    { title: "Add equipment", description: "Record a new stock entry.", href: "/equipment/new", icon: Plus },
    { title: "Review equipment requests", description: "View event requirements from Coordinators.", href: "/equipment/requests", icon: ClipboardCheck },
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

// The passwordless switcher only exists in development builds (and only when the API
// also enables it); everywhere else, real login is the way in.
const DEV_SWITCHER_BUILD = process.env.NODE_ENV === "development";

export default function Home() {
  const router = useRouter();
  const [actingRole, updateRole, , signedOut] = useActingRole();

  useEffect(() => {
    // SCRUM-139: only a confirmed "nobody is signed in" redirects; an unreachable API
    // stays here and shows the sign-in prompt rather than looping through /login.
    if (signedOut && !DEV_SWITCHER_BUILD) router.replace("/login");
  }, [signedOut, router]);

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

          {DEV_SWITCHER_BUILD && (
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

          {/* SCRUM-49 / R07: every role has a Home notifications feed. Attendees keep
              their tailored registration-confirmations view instead. */}
          {actingRole && actingRole !== "Attendee" && <NotificationsFeed audience={actingRole} />}
          {actingRole === "Attendee" && <RegistrationConfirmations />}

          {actingRole && !actions && (
            <div className="rounded-2xl border border-border/80 bg-card p-6 text-sm text-muted-foreground shadow-sm">
              No actions are available for the {actingRole} role yet — {actingRole} tools arrive in a
              later sprint.
            </div>
          )}

          {!actingRole && (
            <div className="rounded-2xl border border-border/80 bg-card p-6 text-sm text-muted-foreground shadow-sm">
              {DEV_SWITCHER_BUILD
                ? "Select a role above to see what it can do."
                : <>Sign in to access your workspace. <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">Go to sign in</Link></>}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
