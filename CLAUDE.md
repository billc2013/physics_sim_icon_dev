# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

GIST Physics SVG Asset Manager — a collaborative tool for Bill and Duncan to review, annotate, and iteratively revise SVG icons used in the GIST physics simulation pipeline (LLM → JSON → Planck.js).

The project is migrating **from a single Claude.ai artifact** ([gist-svg-manager.jsx](gist-svg-manager.jsx)) **to a full-stack Vite + React + Vercel + Modal + Supabase app**.

For the full project context, architecture diagram, schema details, and rationale, **read [overview_April_7.md](overview_April_7.md) first**. That file is the source of truth for "why"; this file is the source of truth for "how to work in the repo."

## Current state of the repo

Pre-migration. The directory only contains:

- [overview_April_7.md](overview_April_7.md) — full project overview
- [gist-svg-manager.jsx](gist-svg-manager.jsx) — 299-line monolithic React component (the artifact)
- [gist-supabase-schema.sql](gist-supabase-schema.sql) — full database schema
- [Dev_Tasks.md](Dev_Tasks.md) — prioritized backlog
- [CLAUDE.md](CLAUDE.md) — this file

There is **no package.json, no node_modules, no Vite project, no git repo yet**. The first dev task creates all of that.

## Working with Bill

- Bill is an educator with a physics/ME background. Comfortable with code as a tool, not a professional dev.
- Mac on Apple Silicon.
- Prefers concise, decision-oriented responses. Explain tradeoffs in plain language, not jargon.
- When introducing new tooling or commands, briefly say *why* it exists, not just how to run it.
- Default to small, reviewable changes. One concern per commit / PR.

## Tech stack (target)

| Layer       | Tech                          | Notes |
|-------------|-------------------------------|-------|
| Frontend    | Vite + React (.jsx)           | SPA, no SSR |
| Styling     | Inline styles (current)       | Migration to Tailwind is a possible future task — do not switch unprompted |
| Hosting     | Vercel                        | Auto-deploy from GitHub `main` |
| API proxy   | Vercel serverless (`api/`)    | TypeScript, Node runtime, thin auth proxy only |
| Compute     | Modal.com (Python)            | Holds all secrets, calls Claude, writes to Supabase |
| LLM         | Anthropic Claude API          | `claude-sonnet-4-20250514` |
| Database    | Supabase Postgres (free tier) | Separate org from Bill's Pro account |
| Auth        | Supabase Auth (email/password)| JWT-based |
| Realtime    | Supabase Realtime             | Subscriptions on `physics_svgs`, `svg_feedback` |

## Architectural ground rules

Do not violate these without explicit discussion:

1. **The browser never sees the Anthropic API key.** All Claude calls go through Vercel → Modal. Vercel validates the user's Supabase JWT, then forwards to Modal.
2. **Vercel functions are thin proxies.** No business logic, no Claude calls, no Supabase writes from Vercel. They exist to validate auth and forward.
3. **All secrets live in Modal** (`modal.Secret`) — the Anthropic key and the Supabase **service role** key. Vercel only has the Supabase URL and anon key.
4. **RLS is enforced.** The browser uses the anon key and gets RLS-restricted access. Modal uses the service role key and bypasses RLS for system-level writes (generation logs, version archival).
5. **Schema source of truth is [gist-supabase-schema.sql](gist-supabase-schema.sql).** Schema changes are made by editing that file *and* running the migration in the Supabase SQL editor. Do not let the file drift from the live DB.
6. **Realtime, not polling.** Use Supabase Realtime channels for cross-user sync.
7. **Versioning is automatic.** The `archive_svg_version()` trigger snapshots old rows to `svg_versions` on UPDATE. Don't reimplement version tracking client-side.

## File structure (target)

See [overview_April_7.md](overview_April_7.md#file-structure-target) for the canonical layout. Summary:

```
src/
  main.jsx, App.jsx
  components/   SvgGrid, SvgCard, DetailModal, GeneratePanel, SystemPrompt, FilterBar
  hooks/        useSupabase, useSvgs, useFeedback, useAuth
  lib/          supabase.js, constants.js
api/            generate.ts (Vercel serverless)
supabase/       schema.sql, security-fixes.sql
modal_functions/ generate_svg.py, keep_alive.py
assets/svgs/    50 reference SVG files
```

## Commands (once Vite is initialized)

```bash
npm install
npm run dev          # Vite dev server, localhost:5173
npm run build        # Production build to dist/
npm run preview      # Preview production build locally

git push origin main                          # Auto-deploys frontend + api/ to Vercel
modal deploy modal_functions/generate_svg.py  # Deploy Modal compute
```

## SVG conventions

- 64×64 viewBox, inline SVG markup stored as `text` in Postgres
- Monochromatic 3-tone (light/mid/dark from one hue) — see palette table in [overview_April_7.md](overview_April_7.md#color-palette-ramps-8-available)
- People rendered in abstract non-skin colors (blue/purple/green/orange) for inclusivity
- Status workflow: `draft` → `revised` → `approved`, plus `idea_only` for concepts that map to physics-engine primitives (rope → distance joint, etc.) rather than standalone SVGs

## UI behaviors worth preserving from the artifact

These are intentional design decisions, not bugs:

- **Filter solo behavior.** Clicking a status filter when all are shown solos that status. Clicking the soloed filter restores all four. More intuitive than separate all/none controls.
- **Idea-only modal variant.** When `status === "idea_only"`, the modal shows a "Notes" textarea (how the concept maps to the physics engine) instead of the feedback form.
- **Per-revision history via the DB.** The `archive_svg_version` trigger snapshots every status/content change to `svg_versions`. The artifact's in-memory undo stack was dropped in Task 3 because "undo" against a shared DB has weird multi-user semantics; a "restore previous version" UI built on `svg_versions` is the planned replacement.
- **Keyboard nav.** Esc closes modal/system-prompt overlay; ← / → navigate visible items in modal; Cmd/Ctrl+Z triggers undo when no modal is open.

## Things to know about the existing artifact

[gist-svg-manager.jsx](gist-svg-manager.jsx) is a Claude.ai artifact, not standard React. Notable artifact-isms to fix during migration:

- Uses `window.storage.get/set` (Claude.ai's persistence shim) instead of `localStorage` or a real backend. Replace with Supabase queries.
- All SVG data is hardcoded as a giant `SVG_DATA` object on line 3. Migrate to seed data and load from Supabase.
- Single-file: components, constants, styles, and the system prompt all live in one file. The first dev task decomposes this.
- Heavy use of single-letter and short variable names (`SC`, `SK`, `vis`, `togFilter`, `fbText`). When decomposing, expand to readable names — this is a one-time chance to clean up tersely-minified artifact code.
- Inline styles throughout (no Tailwind, no CSS modules).

## Working conventions

- **Read before edit.** Always read the current file before proposing changes.
- **Small commits.** One concern per commit. Conventional commit prefixes welcome but not required.
- **Don't add features that weren't asked for.** No speculative abstractions, no scope creep, no "while I'm here" cleanups.
- **Don't introduce dependencies casually.** Each new package is a thing Bill has to maintain. Justify additions.
- **Confirm before destructive or shared-state actions** (force-push, deleting files outside the worktree, deploying, schema changes, sending anything to a third party).
- **Keep [overview_April_7.md](overview_April_7.md) and this file in sync** when architectural decisions change.
