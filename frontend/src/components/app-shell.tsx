"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import {
  Building2,
  ClipboardCheck,
  FilePlus2,
  FileText,
  Home,
  LogOut,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type NavItem = { label: string; href: string; icon: LucideIcon };

// Navigation is role-aware: each role only sees what it can act on.
const NAV_BY_ROLE: Record<string, NavItem[]> = {
  Organiser: [
    { label: "Home", href: "/", icon: Home },
    { label: "New request", href: "/events/new", icon: FilePlus2 },
    { label: "My drafts", href: "/events/drafts", icon: FileText },
    { label: "Venues", href: "/venues", icon: Building2 },
  ],
  Coordinator: [
    { label: "Home", href: "/", icon: Home },
    { label: "Review requests", href: "/events/review", icon: ClipboardCheck },
    { label: "Venues", href: "/venues", icon: Building2 },
  ],
  "Venue Staff": [
    { label: "Home", href: "/", icon: Home },
    { label: "Add venue", href: "/venues/new", icon: FilePlus2 },
    { label: "Venues", href: "/venues", icon: Building2 },
  ],
};

const DEFAULT_NAV: NavItem[] = [{ label: "Home", href: "/", icon: Home }];

export function AppShell({
  actingRole,
  children,
}: {
  actingRole: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = actingRole ? (NAV_BY_ROLE[actingRole] ?? DEFAULT_NAV) : DEFAULT_NAV;

  async function handleLogout() {
    await apiRequest("/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div className="flex items-center justify-between px-5 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight text-white">
          Connect<span className="text-primary">Sphere</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-md p-1 text-slate-400 hover:bg-white/5 hover:text-white lg:hidden"
          aria-label="Close menu"
        >
          <X className="size-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {nav.map(({ label, href, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-white/10 font-medium text-white"
                  : "text-slate-400 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        {actingRole ? (
          <div className="space-y-1">
            <p className="px-2 text-xs text-slate-500">Signed in as</p>
            <p className="px-2 pb-1 text-sm font-medium text-slate-100">{actingRole}</p>
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <LogOut className="size-4" aria-hidden="true" /> Sign out
            </button>
          </div>
        ) : (
          <p className="px-2 text-xs text-slate-500">Not signed in</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Fixed sidebar on desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {/* Off-canvas drawer on mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-64 shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Mobile top bar with menu toggle */}
        <div className="flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
          <Button
            variant="outline"
            size="icon"
            className="rounded-lg"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-4" />
          </Button>
          <span className="font-semibold tracking-tight">
            Connect<span className="text-primary">Sphere</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
