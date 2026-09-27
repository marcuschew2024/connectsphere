import Link from "next/link";

// Shown when access is denied (server 403 or direct navigation to a disallowed page).
// The server is always the authority (SCRUM-21 RBAC); this page just explains the denial.
export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-destructive">403 · Forbidden</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Access denied</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
        You don’t have permission to view this page or perform this action with your
        current role. If you think this is a mistake, check that you’re signed in as the
        right role.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-muted motion-reduce:transition-none"
      >
        <span aria-hidden="true">←</span> Back to overview
      </Link>
    </main>
  );
}
