# UI Design System (SCRUM-125)

ConnectSphere's frontend uses **shadcn/ui (radix base)** on **Next.js 16 / React 19 / Tailwind CSS v4**, a **blue cool-neutral theme**, and a **dark-sidebar app shell** with light content.

## Stack & where things live

| Concern | Location |
| --- | --- |
| Design tokens (colours, radius) | `frontend/src/app/globals.css` — `:root` (light) + `.dark` |
| shadcn components | `frontend/src/components/ui/*` (button, card, badge, input, label, textarea, select, separator, dialog, sonner, tooltip, radio-group) |
| App shell (sidebar + layout) | `frontend/src/components/app-shell.tsx` |
| `cn()` helper | `frontend/src/lib/utils.ts` |
| shadcn config | `frontend/components.json` |

## Theming — one place

All colour is driven by **semantic CSS variables** in `globals.css`. To retheme the whole app, edit those variables (or paste a [tweakcn](https://tweakcn.com) export) — **do not** hardcode colours in components. The current theme is a slate base with a **blue** primary (`--primary: oklch(0.546 0.245 262.881)`), light + dark.

**Use tokens, not raw colours:** `bg-background`, `text-foreground`, `text-muted-foreground`, `bg-card`, `border-border`, `bg-primary`, `text-primary`, `bg-accent`, `text-destructive`, `border-input`, `ring`. Success states use `emerald-*` with a `dark:` variant; the navy sidebar intentionally uses hardcoded `slate-900` + `white/xx` (it is always dark).

## App shell

Authenticated pages render inside `<AppShell actingRole={role}>`:
- Dark navy sidebar: brand, **role-aware nav** (`NAV_BY_ROLE`), "Signed in as {role}" + **Sign out** (logout is centralised in the shell — pages don't plumb it).
- Content is wrapped in a **`<main>` landmark** (e2e tests scope alerts to `main` — keep it a `<main>`).
- Mobile: off-canvas drawer via a top-bar menu button.
- `/login` and `/forbidden` stay **shell-less** (pre-auth), themed with tokens only.

## Adding a component

```bash
cd frontend && npx shadcn@latest add <component>   # radix base, nova preset
```

## Conventions that protect the e2e suite

The Playwright suite selects by **accessible name / label / heading / role**. When restyling:
- Preserve label text, button names, headings, `aria-*`, and roles — change **className only**.
- Avoid duplicate accessible names on one page (e.g. a sidebar nav item vs a content link) — it triggers Playwright strict-mode violations. Home action tiles carry an explicit `aria-label` so exact-name selectors match.
- Keep the content `<main>` landmark.

## Verify before pushing UI changes

```bash
cd frontend
npm run build        # type-check + prod build
npm run lint
npm run test:e2e     # Playwright (prod server); kill stray dev servers first
```

CI (`.github/workflows/ci.yml`) runs lint + build + e2e as the authoritative gate on every PR.

## Local run (port gotcha)

Run the API on **5001** (`flask --app app run`); the frontend defaults to `http://localhost:5001`. **macOS AirPlay squats port 5000** (returns 403) — using 5000 makes the app show "API unreachable" and the demo-user switcher fails to load. See the root `README.md`.
