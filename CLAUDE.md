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

| Component / artifact field     | Schema source                              | Notes |
|--------------------------------|--------------------------------------------|-------|
| `item.id` (string)             | `physics_svgs.name`                        | Used as React keys, item lookup, and as `object_name` for generation |
| `item.label` (string)          | `physics_svgs.display_name`                | Human-readable, capitalized in UI |
| `item.svg` (string)            | `physics_svgs.svg_content`                 | Inline SVG markup |
| `item.status` (enum)           | `physics_svgs.status`                      | draft / revised / approved / idea_only |
| `item.notes` (string)          | `physics_svgs.notes`                       | Used by idea_only items |
| `item.colorTag` (string)       | joined `color_palettes.name`               | e.g. "blue"; null if no palette set |
| `item.feedback` (array)        | `svg_feedback` rows for this svg_id        | `[{text, date}]` shape |
| `item.version` (int)           | `physics_svgs.version`                     | Bumped by the archive trigger on content/status change |
| `item.updatedAt`               | `physics_svgs.updated_at`                  | Auto-bumped by `moddatetime` on every UPDATE. Compared against `lastExportedAt` for the stale check. |
| `item.lastExportedAt`          | `physics_svgs.last_exported_at`            | ISO timestamp or null — set by the Download approved flow via the `mark_svgs_exported` RPC |
| `item.lastExportedVersion`     | `physics_svgs.last_exported_version`       | `version` value at time of last export. Displayed in the "Exported as v3" line; NOT used for the stale check. |
| `item.lastExportedByName`      | joined `project_members.display_name` via `last_exported_by` | Who last exported this item |
| `item.physicalProperties`      | `physics_svgs.physical_properties` (jsonb) | Free-form, v1 shape is `{mass_kg, length_m, width_m, notes}`. Emitted in manifest.json |
| `item._uuid` (string)          | `physics_svgs.id`                          | **Private**. Only used for write paths and as `svg_id` in revisions. |

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

### Download approved (zip export)

Header **"Download approved"** opens [DownloadApprovedModal.jsx](src/components/DownloadApprovedModal.jsx), which presents a scope radio + manifest checkbox and calls `handleConfirmDownload` in App.jsx on confirm.

- **Two scopes:** `new_or_updated` (default) and `all_approved`. Counts shown inline so you know what you're committing to. The scope filter uses `needsExport(item)` from [useSvgs.js](src/hooks/useSvgs.js) (`lastExportedAt == null || isStale(item)`).
- **Manifest (default on):** `manifest.json` emitted into the zip with shape `{ manifest_version: 1, exported_at, exported_by, export_mode, items: [{ name, display_name, status, version, color_tag, physical_properties }] }`. The downstream physics-sim pipeline reads this to pick up metadata (mass, length, width) that's not encoded in the SVG itself. Bump `manifest_version` when the shape changes.
- **Zip filename:** `physics-sim-svgs-YYYY-MM-DD.zip`. Re-exporting the same day means your browser auto-renames `(1)`, `(2)`, etc.
- **JSZip** does the zipping in-browser. No server-side zip function. ~50 × 1 KB files takes milliseconds.
- **DB stamping via RPC:** after a successful zip, `useSvgs.markExported(uuids)` calls the `mark_svgs_exported` Postgres RPC (schema migration 11b). Server-side because `updated_at` and `last_exported_at` need to end up set to the SAME transaction-local `now()` — a client-supplied ISO string diverges from moddatetime's server timestamp by the network round trip, and that's enough to make the stale check fire on items you just exported. The RPC runs SECURITY DEFINER with an `auth.uid()` project-membership gate so it's safe from client tampering.
- **Failure mode:** if the zip download succeeds but `markExported` fails (e.g. RLS/network), we show a toast explaining the mismatch but we don't try to "undo" the download. The next export will re-include the un-stamped items — harmless, just slightly inefficient.
- **Stale predicate — single source of truth.** `isStale(item)` from [useSvgs.js](src/hooks/useSvgs.js) is `lastExportedAt != null && updatedAt > lastExportedAt`. Used by **SvgCard** (amber dot bottom-right), **DetailModal** (the "(changes since)" suffix on the exported-as line), and transitively by **DownloadApprovedModal** via `needsExport`. All three MUST use this helper so they always agree — diverging predicates confuse users about which items will be in the next export.
- **Why `updatedAt > lastExportedAt`, not `version > lastExportedVersion`?** The archive-version trigger only bumps `version` on content/status changes. A color-tag change or a physical_properties change bumps `updated_at` (via moddatetime) but NOT `version`, and those changes matter because `color_tag` and `physical_properties` are both in the manifest. The updatedAt predicate catches them; the version predicate doesn't. Slight side effect: notes-only changes also mark stale even though notes aren't in the manifest. Harmless false positive — a re-export just re-ships identical files.
- **Optimistic-update contract:** mutations that touch `physics_svgs` (`updateStatus`, `updateNotes`, `updateColor`, `updateSvgContent`, and the status-promotion branch of `addFeedback`) all chain `.select("version, updated_at").single()` and return those values from `dbWrite` so `optimisticUpdate` can patch them back into local state. Without this, the client's local `updatedAt` drifts from the DB after any mutation and the stale check silently misses changes until the next refresh.
- **Exported-as line in DetailModal:** single 11px line below the SVG image, shown only when `lastExportedAt != null`, reading `Exported as v3 · 2026-04-09 · Bill` with an amber `(changes since)` suffix driven by `isStale(item)`. Hidden for idea_only items.
- **FilterBar "Downloaded" toggle:** independent boolean that intersects with the status filter set. When on, only items with `lastExportedAt != null` are visible. Counts show `Downloaded (N)` regardless of the status filter so it always reflects the global project state.

### Model tiers

Both flows let the user pick between two Claude models before firing a generation. The selector is a shared `<ModelTierToggle>` pill switch rendered in both [GenerateNewModal.jsx](src/components/GenerateNewModal.jsx) and [DetailModal.jsx](src/components/DetailModal.jsx).

| Tier       | Model ID              | Price (in/out per MTok) | When to use |
|------------|-----------------------|-------------------------|-------------|
| Standard   | `claude-sonnet-4-6`   | $3 / $15                | Default for all generations |
| Advanced   | `claude-opus-4-6`     | $15 / $75               | Escalate when Standard can't nail the SVG |

Behavior:

- The tier toggle **resets to Standard each time DetailModal opens a new item** (`useEffect` on `item.id`), so Advanced is never sticky across objects. Explicit opt-in per-call prevents accidental runaway Opus spend.
- The frontend sends `model_tier: "standard" | "advanced"` in the `/api/generate` POST body. The Vercel proxy validates against that allow-list before forwarding (defense in depth — don't trust an arbitrary string from the client).
- Modal's [generate_svg.py](modal_functions/generate_svg.py) defines `MODEL_TIERS` mapping each tier to `{ model, input_price_per_mtok, output_price_per_mtok }`. The function looks up the tier, uses its model id for the Anthropic call, and uses its pricing in the `cost_usd` audit column.
- The **UI intentionally does not label which model produced a given SVG** — Bill's call. The attribution lives in the database: `generation_sessions.model` records the resolved model id per call, so dev review can go through the table to see tier usage.
- Pricing constants in `MODEL_TIERS` are used only for the audit `cost_usd` column, not for real billing. Mild drift vs. Anthropic's actual prices is tolerable; update when they change.

To add/remove/rename a tier, edit both `MODEL_TIERS` in `generate_svg.py` AND the `ALLOWED_MODEL_TIERS` array in `api/generate.ts`, plus the `tiers` array in `ModelTierToggle.jsx`. All three must agree. (If this becomes a recurring chore, move the tier list to a shared JSON file alongside `shared/system_prompt.json`.)

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

## System prompt — single source of truth

The Claude generation prompt lives in **[shared/system_prompt.json](shared/system_prompt.json)**. Both runtimes read the same file:

- [src/lib/constants.js](src/lib/constants.js) — `buildSystemPrompt(items)` imports the JSON at build time and renders it for the SystemPrompt overlay
- [modal_functions/generate_svg.py](modal_functions/generate_svg.py) — `build_system_prompt(library_names)` reads `/root/system_prompt.json` from inside the Modal container and renders it for actual Claude calls

Shape: `{ header, rules[], librarySection }`. Both renderers prefix each rule with `- ` and substitute `{count}` and `{names}` in `librarySection`. If you change the JSON shape (not the content), update both renderers in lockstep.

**Redeploy reminder: editing the JSON requires `modal deploy modal_functions/generate_svg.py`** to push the change to the Python side. The image definition uses `.add_local_file(...)` to bake the JSON into the container, so Modal only sees the version from the last deploy. The Vite side picks up JSON edits on the next dev reload / build automatically.

Expected iteration loop while tuning the prompt: edit `shared/system_prompt.json` → refresh browser to verify the overlay → `modal deploy modal_functions/generate_svg.py` → trigger a generation to test against Claude.

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
- **Auto-promote draft → revised on feedback OR on revision accept.** Adding feedback to a draft, or accepting a Claude revision on a draft, promotes the status to `revised`. Other statuses are left alone. **Manual uploads also auto-promote** because they go through the same `updateSvgContent` path.
- **Two-flow generation.** Generate-new vs revise-existing are separate UIs with separate state — don't try to unify them.
- **Manual SVG download/upload in DetailModal.** Inline `↓ Download` / `↑ Upload` row directly under the existing SVG image. Hidden when `status === "idea_only"`. Workflow: download → edit in Inkscape (or any external editor) → upload → preview → Accept. Upload goes through `useSvgs.updateSvgContent` — same path as Claude revisions — so the version-archive trigger fires and a draft auto-promotes to revised. From the schema's POV an uploaded SVG and a Claude-generated SVG are indistinguishable; only `generation_sessions` records "Claude was involved".
- **SVG sanitization on upload.** All uploaded SVGs are sanitized with [DOMPurify](https://github.com/cure53/DOMPurify) (`USE_PROFILES: { svg: true, svgFilters: true }`) before they hit state. This strips `<script>`, `on*` event attrs, `javascript:` URLs, `<foreignObject>` HTML payloads, and external `<use href>` exfiltration. If the sanitized output differs from the input the preview surfaces a non-blocking yellow warning so silent stripping isn't a mystery. **Note:** Claude-generated SVGs are NOT yet sanitized; that's a backlog item in [Dev_Tasks.md](Dev_Tasks.md).
- **Upload size cap: 100 KB.** Existing files are ~1 KB; cap exists to catch "wrong file" disasters, not as a real budget.
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
