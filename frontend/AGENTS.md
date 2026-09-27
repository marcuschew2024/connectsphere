<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ConnectSphere frontend — project rules for AI agents

**Design system:** shadcn/ui (radix) + Tailwind v4. All colour comes from semantic
tokens in `src/app/globals.css` (blue theme, light + dark). **Never hardcode colours** —
use `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-card`,
`border-border`, `bg-primary`/`text-primary`, `text-destructive`, `border-input`, `ring`.
Retheme by editing the CSS variables only. Full guide: `../docs/UI_DESIGN_SYSTEM.md`.

**App shell:** authenticated pages render inside `<AppShell actingRole={role}>`
(`src/components/app-shell.tsx`) — dark navy sidebar + light content. The shell renders
the page's `<main>` landmark and owns logout. `/login` and `/forbidden` stay shell-less.

**Protect the e2e suite:** tests select by accessible name / label / heading / role.
When restyling, change **className only** — keep label text, button names, headings,
`aria-*`, roles, and the `<main>` landmark. Avoid duplicate accessible names on a page.

**Before pushing UI changes:** `npm run build && npm run lint && npm run test:e2e`
(e2e runs the prod server — kill stray dev servers first). CI is the authoritative gate.

**Local run:** API on **5001** (`flask --app app run`); frontend defaults to 5001.
macOS AirPlay squats port 5000 — do not use it.
