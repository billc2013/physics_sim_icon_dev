# CLAUDE.md

Guidance for Claude Code when working in this repository.

> **Note:** This file and `Dev_Tasks.md` are gitignored — they're working notes shared between Bill and Claude, not committed to the repo. Keep them current because Bill relies on them as the running state of the project across Claude sessions.

## What this project is

GIST Physics SVG Asset Manager — a collaborative tool for Bill and Duncan to review, annotate, and iteratively revise SVG icons used in the GIST physics simulation pipeline (LLM → JSON → Planck.js).

The project has migrated from a single Claude.ai artifact ([gist-svg-manager.jsx](gist-svg-manager.jsx), still in the repo as reference) to a working full-stack Vite + React + Vercel + Modal + Supabase app. Phases 1 and 3 are done locally; deploy (Phase 4) and Realtime (Phase 2) are still ahead.

For full project context, architecture diagram, schema details, and rationale, **read [overview_April_7.md](overview_April_7.md)**. That file is the source of truth for "why"; this file is the source of truth for "how to work in the repo."

## Current state (as of last session)

Working end-to-end **on localhost**:

- ✓ Vite + React app, decomposed into components/hooks/lib
- ✓ Supabase auth (login UI, session handling, sign in / sign up / sign out)
- ✓ Supabase data layer (`useSvgs` reads `svgs_with_details` view + `svg_feedback`, optimistic update mutations for status/notes/color/feedback)
- ✓ Seed script with all 50 original SVGs in the database, attributed to Bill as `created_by`
- ✓ Bill exists in `project_members` as owner; RLS enforced
- ✓ Modal `generate_svg` deployed with both `modal run` entrypoint and `@modal.fastapi_endpoint` HTTP endpoint
- ✓ Vercel `api/generate.ts` proxy validates JWTs and forwards to Modal (locally via `vercel dev`)
- ✓ Two generation flows working end-to-end through the browser:
  - **Flow A** (Header "Generate more"): brand-new SVG → INSERT into `physics_svgs`
  - **Flow B** (DetailModal "Send to Claude"): revise existing SVG → UPDATE, auto-archives via trigger

Not yet done:

- ✗ Realtime subscriptions (Task 5) — `useSvgs` reloads on mutation, no live cross-user sync
- ✗ Modal `keep_alive()` weekly cron (Task 8) — Supabase free tier will pause after 7 days idle
- ✗ Push to GitHub + Vercel auto-deploy (Task 9) — production URL doesn't exist yet
- ✗ Duncan in `project_members` (Task 4) — happens after he signs up via the deployed app
- ✗ Zip export of approved SVGs (Task 10)

See [Dev_Tasks.md](Dev_Tasks.md) for the prioritized backlog and what each remaining task involves.

## Working with Bill

- Bill is an educator with a physics/ME background. Comfortable with code as a tool, not a professional dev.
- Mac on Apple Silicon.
- Prefers concise, decision-oriented responses. Explain tradeoffs in plain language, not jargon.
- When introducing new tooling or commands, briefly say *why* it exists, not just how to run it.
- Default to small, reviewable changes. One concern per commit / PR.
- Bill runs commands himself in his own terminal — prefer to *coach* through terminal steps rather than running them via Bash unless verification is needed.
- For multi-step tasks (especially involving secrets, deploys, or external dashboards), present the steps as a numbered walkthrough Bill follows, then let him report back with results or errors.
- Use the `AskUserQuestion` tool to gather decisions when there are real choices to make (see prior session pattern in this repo).

## Tech stack

| Layer       | Tech                          | Notes |
|-------------|-------------------------------|-------|
| Frontend    | Vite + React 19 (.jsx)        | SPA, no SSR |
| Styling     | Inline styles                 | No Tailwind, no CSS modules. Migration is a possible future task — do not switch unprompted |
| Hosting     | Vercel                        | Project linked locally as `bill-churchs-projects/physics-sim-icon-dev`. Auto-deploy from GitHub `main` is Task 9 |
| API proxy   | Vercel serverless (`api/`)    | TypeScript, Node runtime, thin auth proxy only |
| Compute     | Modal.com (Python)            | Holds all secrets, calls Claude, writes to Supabase. Workspace: `billc2013` |
| LLM         | Anthropic Claude API          | `claude-sonnet-4-20250514` |
| Database    | Supabase Postgres (free tier) | Project ref `ohsehevfhfnbrfpnhyxv` (separate org from Bill's Pro account) |
| Auth        | Supabase Auth (email/password)| JWT-based. Bill uses a Supabase publishable key (`sb_publishable_...`) format, not a classic JWT anon key — works fine |
| Realtime    | Supabase Realtime             | Tables enabled in schema, no client subscriptions yet |

## Architectural ground rules

Do not violate these without explicit discussion:

1. **The browser never sees the Anthropic API key.** All Claude calls go through Vercel → Modal. Vercel validates the user's Supabase JWT, then forwards to Modal.
2. **Vercel functions are thin proxies.** No business logic, no Claude calls, no Supabase writes from Vercel. They exist to validate auth and forward.
3. **The Vercel proxy injects `requested_by` from the validated JWT** — never trust whatever value the client sends for that field.
4. **All secrets live in Modal** (`modal.Secret`) — the Anthropic key and the Supabase **service role** key. Vercel only has the Supabase URL and publishable/anon key.
5. **RLS is enforced.** The browser uses the publishable key and gets RLS-restricted access. Modal uses the service role key and bypasses RLS for system-level writes (generation logs, version archival, seed).
6. **Schema source of truth is [gist-supabase-schema.sql](gist-supabase-schema.sql)** (note: gitignored locally). Schema changes are made by editing that file *and* running the migration in the Supabase SQL editor. Do not let the file drift from the live DB.
7. **Realtime, not polling.** Use Supabase Realtime channels for cross-user sync once Task 5 lands.
8. **Versioning is automatic.** The `archive_svg_version()` trigger snapshots old rows to `svg_versions` on UPDATE. Don't reimplement version tracking client-side.
9. **The seed script and Modal both need a real `auth.users.id` for `created_by` / `requested_by`.** There's no NULL fallback; bootstrap by signing up first, then seeding.

## Actual file structure

```
.
├── api/
│   └── generate.ts               Vercel proxy: JWT validation + Modal forward
├── modal_functions/
│   ├── generate_svg.py           Modal function with both `modal run` entry
│   │                              and `@modal.fastapi_endpoint` HTTP endpoint
│   └── requirements.txt          Stale leftover from another Bill project — Modal
│                                  reads deps from image.pip_install(), not this file
├── scripts/
│   └── seed.js                   One-shot Node script: inserts 50 SVGs with
│                                  service role key passed inline at run time
├── src/
│   ├── main.jsx
│   ├── App.jsx                   Auth gate + SignedInApp orchestration; holds
│   │                              two useGeneration instances (Flow A and Flow B)
│   ├── index.css                 Theme variables matching the artifact's
│   │                              Claude.ai-style CSS variable references
│   ├── components/
│   │   ├── ColorPaletteTag.jsx
│   │   ├── DetailModal.jsx       Has inline "revision preview" panel for Flow B
│   │   ├── FeedbackHistory.jsx
│   │   ├── FilterBar.jsx
│   │   ├── GenerateNewModal.jsx  Flow A overlay with collision detection
│   │   ├── GeneratePanel.jsx     STUB — leftover from Task 2, not used. Remove or repurpose.
│   │   ├── Header.jsx
│   │   ├── LoginPage.jsx
│   │   ├── SvgCard.jsx
│   │   ├── SvgGrid.jsx
│   │   ├── SystemPrompt.jsx
│   │   └── Toast.jsx
│   ├── hooks/
│   │   ├── useAuth.js            Session, signIn/signUp/signOut, onAuthStateChange
│   │   ├── useGeneration.js      State machine for /api/generate calls
│   │   └── useSvgs.js            Loads view + feedback, exposes mutations,
│   │                              transforms schema rows into artifact item shape
│   └── lib/
│       ├── constants.js          STATUSES, STATUS_CONFIG, COLOR_RAMPS,
│       │                          buildSystemPrompt() — keep in sync with Python
│       ├── seedData.js           SVG_DATA constant + createInitialItems()
│       └── supabase.js           Singleton client from import.meta.env
├── .env.local                    GITIGNORED. Holds VITE_SUPABASE_URL,
│                                  VITE_SUPABASE_ANON_KEY, MODAL_ENDPOINT_URL
├── .env.local.example            Template, also gitignored (Bill's call)
├── CLAUDE.md                     This file. GITIGNORED.
├── Dev_Tasks.md                  Backlog. GITIGNORED.
├── eslint.config.js              Two configs: src/ for browser, scripts/ for Node
├── gist-supabase-schema.sql      Full schema. GITIGNORED.
├── gist-svg-manager.jsx          Original artifact. Kept as reference; not in build.
├── overview_April_7.md           Project overview, architecture, rationale
├── package.json
└── vite.config.js
```

## Schema ↔ item shape mapping

`useSvgs` transforms Postgres rows into the artifact's item shape so the components don't need to know the schema. **This mapping is load-bearing — components rely on it.**

| Component / artifact field | Schema source                         | Notes |
|----------------------------|---------------------------------------|-------|
| `item.id` (string)         | `physics_svgs.name`                   | Used as React keys, item lookup, and as `object_name` for generation |
| `item.label` (string)      | `physics_svgs.display_name`           | Human-readable, capitalized in UI |
| `item.svg` (string)        | `physics_svgs.svg_content`            | Inline SVG markup |
| `item.status` (enum)       | `physics_svgs.status`                 | draft / revised / approved / idea_only |
| `item.notes` (string)      | `physics_svgs.notes`                  | Used by idea_only items |
| `item.colorTag` (string)   | joined `color_palettes.name`          | e.g. "blue"; null if no palette set |
| `item.feedback` (array)    | `svg_feedback` rows for this svg_id   | `[{text, date}]` shape |
| `item._uuid` (string)      | `physics_svgs.id`                     | **Private**. Only used for write paths and as `svg_id` in revisions. |

When writing back: `useSvgs` looks up `_uuid` via `findUuid(id)`, translates `colorTag` (string) → `color_id` (UUID) via a cached `paletteIdByNameRef`, and always sets `updated_by = user.id` so the version-archive trigger attributes the OLD row correctly.

## Generation pipeline (two flows)

Both flows hit the same backend chain: browser → `/api/generate` (Vercel) → Modal `generate_svg_http` HTTP endpoint → calls `generate_svg.local(...)` internally → Claude → Supabase audit log → JSON back.

### Flow A — Generate new

- Triggered by Header **"Generate more"** button
- Opens `<GenerateNewModal>` overlay
- Collision detection on input change against `existingNames` Set passed in from App
- On Accept: `useSvgs.insertSvg({ name, displayName, svgContent })` → INSERT into `physics_svgs` with `created_by = updated_by = user.id`, then `refresh()`

### Flow B — Revise existing

- Triggered by DetailModal **"Send to Claude"** button (only visible when a modal item is open)
- Includes the item's existing `feedback` AND any unsaved text in the feedback textarea
- Sends `svg_id`, `current_svg`, `color_palette` derived from `colorTag`
- Inline preview rendered below the existing SVG inside the DetailModal
- On Accept: `useSvgs.updateSvgContent(id, newSvg)` → UPDATE `physics_svgs` (trigger archives prior version, bumps version int)

App.jsx holds **two independent `useGeneration` instances** (`newGeneration` for Flow A, `reviseGeneration` for Flow B) so they can run concurrently without state collision.

## Modal secrets and env vars (Bill-specific naming)

These names diverged from the original plan in CLAUDE.md after Bill set them up. Use these:

| Modal secret name           | Env vars exposed inside the function           |
|-----------------------------|-----------------------------------------------|
| `anthropic-api`             | `ANTHROPIC_API_KEY`                           |
| `supabase_for_svg_gen`      | `SUPABASE_DATA_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

The function references both via `modal.Secret.from_name(...)` in [modal_functions/generate_svg.py](modal_functions/generate_svg.py).

## Vercel env vars — important behavior

`vercel dev` reads env vars from the **linked Vercel project's dashboard first**, NOT from `.env.local`. If the project dashboard has nothing, the function gets `undefined` even when `.env.local` is populated.

This caused a long debugging session at the end of Task 7. The fix is to put the same three vars in the Vercel project at `development` scope:

```bash
vercel env add VITE_SUPABASE_URL development
vercel env add VITE_SUPABASE_ANON_KEY development
vercel env add MODAL_ENDPOINT_URL development
```

Verify with `vercel env ls`. **For Task 9 (production deploy)**, repeat with `production` scope.

The browser-side Vite app reads from `import.meta.env.VITE_*` at build time, which DOES use `.env.local`. So `.env.local` is still load-bearing for the React app — the Vercel-dashboard requirement is only for the `api/` function process.

## System prompt is duplicated

The Claude generation prompt template lives in TWO places:

- [src/lib/constants.js](src/lib/constants.js) — `buildSystemPrompt(items)` (used to display the current prompt in the SystemPrompt overlay)
- [modal_functions/generate_svg.py](modal_functions/generate_svg.py) — `build_system_prompt(library_names)` (used for actual Claude calls)

**They must be kept in sync manually.** A comment in each file reminds you. Bill has edited the JS version since the initial migration (current "People: modeled after traffic sign pictograms, no faces or details" wording) — verify the Python copy matches before generation tasks.

If the prompt starts changing frequently, move it to a shared `.txt` file or a Supabase config table. Until then, in-place duplication is fine.

## SVG conventions

- 64×64 viewBox, inline SVG markup stored as `text` in Postgres
- Monochromatic 3-tone (light/mid/dark from one hue) — see palette table in [overview_April_7.md](overview_April_7.md#color-palette-ramps-8-available)
- People rendered as traffic-sign pictograms, no faces or details (per Bill's prompt edit)
- Status workflow: `draft` → `revised` → `approved`, plus `idea_only` for concepts that map to physics-engine primitives (rope → distance joint, etc.) rather than standalone SVGs

## UI behaviors worth preserving

These are intentional design decisions, not bugs:

- **Filter solo behavior.** Clicking a status filter when all are shown solos that status. Clicking the soloed filter restores all four. More intuitive than separate all/none controls.
- **Idea-only modal variant.** When `status === "idea_only"`, the DetailModal shows a "Notes" textarea (how the concept maps to the physics engine) instead of the feedback form.
- **Per-revision history via the DB.** The `archive_svg_version` trigger snapshots every status/content change to `svg_versions`. The artifact's in-memory undo stack was dropped in Task 3 because "undo" against a shared DB has weird multi-user semantics; a "restore previous version" UI built on `svg_versions` is the planned replacement.
- **Auto-promote draft → revised on feedback OR on revision accept.** Adding feedback to a draft, or accepting a Claude revision on a draft, promotes the status to `revised`. Other statuses are left alone.
- **Two-flow generation.** Generate-new vs revise-existing are separate UIs with separate state — don't try to unify them.
- **Keyboard nav.** Esc closes modal/system-prompt overlay; ← / → navigate visible items in modal. (Cmd/Ctrl+Z undo was removed in Task 3.)

## Commands

```bash
# Frontend
npm install
npm run dev          # Vite-only dev server (no /api routes), localhost:5173
npm run build        # Production build to dist/
npm run preview      # Preview production build locally
npm run lint         # ESLint

# Full stack local dev (frontend + Vercel api/ function)
vercel dev           # Runs Vite AND api/ on the same port (typically localhost:3000)

# Seed script — service role key is grabbed inline so it never lives on disk
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... BILL_USER_ID=... node scripts/seed.js

# Modal
modal deploy modal_functions/generate_svg.py  # Deploys both `modal run` and HTTP endpoint
modal run modal_functions/generate_svg.py --object-name foo --requested-by <uuid>

# Vercel env vars (set once per env scope)
vercel env add VITE_SUPABASE_URL development
vercel env ls
```

## Working conventions

- **Read before edit.** Always read the current file before proposing changes.
- **Small commits.** One concern per commit. Conventional commit prefixes welcome but not required. Bill creates commits himself.
- **Don't add features that weren't asked for.** No speculative abstractions, no scope creep, no "while I'm here" cleanups.
- **Don't introduce dependencies casually.** Each new package is a thing Bill has to maintain. Justify additions.
- **Confirm before destructive or shared-state actions** (force-push, deleting files outside the worktree, deploying, schema changes, sending anything to a third party).
- **If you're stuck on a config issue, check the env vars in Vercel dashboard before assuming the code is wrong.** This bit us hard at the end of Task 7.
- **Keep [overview_April_7.md](overview_April_7.md), this file, and [Dev_Tasks.md](Dev_Tasks.md) in sync** when architectural decisions change.

## Known minor issues / deferred cleanup

Things noted but not yet fixed. Don't surprise-fix them; flag and ask.

- `src/components/GeneratePanel.jsx` is a leftover stub from Task 2. The real Flow A UI lives in `GenerateNewModal.jsx`. Either delete or repurpose.
- `gist-svg-manager.jsx` is still on disk. Bill kept it as a reference after Task 3. Delete whenever it's no longer useful for comparison.
- `modal_functions/requirements.txt` is from another Bill project — Modal reads deps from `image.pip_install(...)`, not this file. Probably safe to delete but confirm with Bill.
- `modal_functions/__pycache__/` is not in `.gitignore` and may end up tracked. Add `__pycache__/` to gitignore if it ever shows up in `git status`.
- `@vercel/node` (devDep, used only for TypeScript types in `api/generate.ts`) brings transitive `undici` audit warnings. Runtime impact is zero; the fix would be a breaking downgrade. Left alone.
- `.env.local.example` is currently gitignored — that's intentional per Bill (the file lives only on his machine). For Task 9 deploy docs we may want to commit a copy.
