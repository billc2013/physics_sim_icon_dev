# CLAUDE.md

Guidance for Claude Code when working in this repository.

> **Note:** This file and `Dev_Tasks.md` are working notes shared between Bill and Claude — they're git-tracked (committed to the repo), not gitignored. Keep them current because Bill relies on them as the running state of the project across Claude sessions.

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
- ✓ Vercel `api/batch-generate.ts` proxy for batch generation (category + color variant modes)
- ✓ Four generation flows working end-to-end through the browser:
  - **Flow A** (Header "Generate one"): brand-new SVG → INSERT into `physics_svgs`
  - **Flow B** (DetailModal "Send to Claude"): revise existing SVG → UPDATE, auto-archives via trigger

Not yet done:

- ✗ Realtime subscriptions (Task 5) — `useSvgs` reloads on mutation, no live cross-user sync
- ✓ Modal `keep_alive()` daily cron (Task 8) — `modal_functions/keep_alive.py`, runs every day 06:00 UTC
- ✗ Push to GitHub + Vercel auto-deploy (Task 9) — production URL doesn't exist yet
- ✗ Duncan in `project_members` (Task 4) — happens after he signs up via the deployed app
- ✗ Zip export of approved SVGs (Task 10)

Done (off-task-list):

- ✓ Collider system — schema, programmatic generator, interactive editor, LLM-generated colliders on Flows A/B/C
- ✓ Parent-child parenting — `parent_id` FK, always-inherit physical_properties, color dots on parent cards, manifest uses effective props
- ✓ Trash (soft delete) + rename — `deleted_at`/`deleted_by` columns, active-only partial unique index, TrashPanel restore/purge, DetailModal rename of slug + label (schema migration 11d). See [Trash and rename](#trash-soft-delete-and-rename)
- ◐ Collider Lab (Task 13, **Phase 1 of 4 shipped**) — dedicated `Collider Lab` tab: read-only audit/triage surface grouping SVGs by collider shape with a grid-backed ground-truth inspector that reveals out-of-bounds colliders. Editing/generation/pill-editor are Phases 2–4. See [Collider Lab](#collider-lab)

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
| LLM         | Anthropic Claude API          | `claude-sonnet-4-6` (Standard) / `claude-opus-4-8` (Advanced) — see Model tiers |
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
6. **Schema source of truth is [gist-supabase-schema.sql](gist-supabase-schema.sql)** (git-tracked). Schema changes are made by editing that file *and* running the migration in the Supabase SQL editor. Do not let the file drift from the live DB.
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
│   ├── keep_alive.py             Daily cron: pings heartbeat table to prevent
│   │                              Supabase free-tier pause. Separate Modal app.
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
│   │   ├── ColliderEditor.jsx    Interactive polygon editor overlay (drag/add/remove vertices)
│   │   ├── ColliderPreview.jsx   Static collider overlay (blue dashed shape); optional
│   │   │                          viewBoxMinX/MinY for an expanded coord space
│   │   ├── ColliderLab.jsx       Collider Lab tab: facet grouping + triage list (Task 13)
│   │   ├── ColliderGroundTruth.jsx  Grid-backed inspector; reveals out-of-bounds colliders
│   │   ├── ColorPaletteTag.jsx
│   │   ├── DetailModal.jsx       Has inline "revision preview" panel for Flow B,
│   │   │                          collider generate/edit/save section, inheritance display
│   │   ├── FeedbackHistory.jsx
│   │   ├── FilterBar.jsx
│   │   ├── GenerateNewModal.jsx  Flow A overlay with collision detection
│   │   ├── GeneratePanel.jsx     STUB — leftover from Task 2, not used. Remove or repurpose.
│   │   ├── Header.jsx
│   │   ├── LoginPage.jsx
│   │   ├── SvgCard.jsx           Color dots on parent cards, ↑parent on variant cards
│   │   ├── SvgGrid.jsx
│   │   ├── SystemPrompt.jsx
│   │   └── Toast.jsx
│   ├── hooks/
│   │   ├── useAuth.js            Session, signIn/signUp/signOut, onAuthStateChange
│   │   ├── useGeneration.js      State machine for /api/generate calls
│   │   └── useSvgs.js            Loads view + feedback, exposes mutations,
│   │                              transforms schema rows into artifact item shape
│   └── lib/
│       ├── colliderGenerator.js  Programmatic SVG → collider (convex hull, no deps)
│       ├── colliderSchema.js     Collider types, validation, editing helpers
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
| `item.physicalProperties`      | `physics_svgs.physical_properties` (jsonb) | Own physical props (null for children). V1 shape: `{collider, mass_kg, length_m, width_m, notes}` |
| `item.deletedAt` (string\|null) | `physics_svgs.deleted_at`                 | ISO timestamp if trashed, else null. Trashed items live in `trashedItems`, NOT `items`. |
| `item.deletedByName` (string\|null) | joined `project_members.display_name` via `deleted_by` | Who trashed it |
| `item.parentId` (string\|null) | joined `physics_svgs.name` via `parent_id`  | Parent's item.id (name), null if root/standalone |
| `item._parentUuid` (string\|null) | `physics_svgs.parent_id`                | **Private**. Parent's UUID for write paths |
| `item._uuid` (string)          | `physics_svgs.id`                          | **Private**. Only used for write paths and as `svg_id` in revisions. |
| `item.variants` (array)        | Computed client-side by `addVariantInfo()`  | `[{id, colorTag}]` — children of this item. Empty if not a parent. |
| `item.effectivePhysicalProperties` | Computed client-side by `addVariantInfo()` | Parent's `physicalProperties` if child, own if root. **Always use this for reads.** |

When writing back: `useSvgs` looks up `_uuid` via `findUuid(id)`, translates `colorTag` (string) → `color_id` (UUID) via a cached `paletteIdByNameRef`, and always sets `updated_by = user.id` so the version-archive trigger attributes the OLD row correctly.

**Parenting rule:** `physical_properties` writes (collider, mass, etc.) always target the parent item for children. The `updatePhysicalProperties` mutation propagates changes optimistically to all children's `effectivePhysicalProperties`.

## Generation pipeline (four flows)

Single-object flows hit: browser → `/api/generate` (Vercel) → Modal `generate_svg_http` → `generate_svg.local(...)` → Claude → Supabase audit log → JSON back.

Batch flows hit: browser → `/api/batch-generate` (Vercel) → Modal `batch_generate_svg_http` → `batch_generate_svg.local(...)` → Claude (single call returning JSON array) → audit log → JSON back.

### Flow A — Generate one

- Triggered by Header **"Generate one"** button
- Opens `<GenerateNewModal>` overlay
- Collision detection on input change against `existingNames` Set passed in from App
- On Accept: `useSvgs.insertSvg({ name, displayName, svgContent, physicalProperties })` → INSERT into `physics_svgs` with collider from the LLM response baked into `physical_properties`, then `refresh()`

### Flow B — Revise existing (queued)

- Triggered by DetailModal **"Send to Claude"** button
- **Fire-and-forget**: adds a job to the generation queue and toasts "Revision queued". The user can close the DetailModal and work on other items immediately.
- Includes the item's existing `feedback` AND any unsaved text in the feedback textarea
- Sends `svg_id`, `current_svg`, `color_palette` derived from `colorTag`
- When the job completes, a toast notifies the user. They open the **QueuePanel** (Header badge) to preview and Accept/Discard the revision.
- On Accept: `useSvgs.updateSvgContent(id, newSvg)` → UPDATE `physics_svgs` (trigger archives prior version, bumps version int). Also saves the LLM-generated collider to the **parent** item (or self if no parent) via `updatePhysicalProperties`.
- While on the item, a blue inline bar shows queue status: `Queue: 1 generating — open Queue to review`

### Flow C — Batch generate by category (queued)

- Triggered by Header **"Batch generate"** button
- Opens `<BatchGenerateModal>` — **setup only** (category dropdown from `shared/system_prompt.json` categories array, free-text "Other" option, model tier toggle). On Generate, adds a job to the queue and closes.
- Fixed at 10 items per batch
- One Claude call returns `[{name, svg, collider}]` JSON array
- Results reviewed in **QueuePanel**: cherry-pick grid with checkboxes. Items whose name already exists get auto-deselected with a red "(exists)" badge.
- On Accept: loops through selected items, calling `useSvgs.insertSvg` for each
- Batch endpoint: `batch_generate_svg` in [generate_svg.py](modal_functions/generate_svg.py) with mode `"category"`, proxied through [api/batch-generate.ts](api/batch-generate.ts). **Requires `MODAL_BATCH_ENDPOINT_URL` env var** in the Vercel project (separate from `MODAL_ENDPOINT_URL`). URL printed by `modal deploy`.

### Flow D — Color variants (queued)

- Triggered by DetailModal **"Generate in N colors"** button
- **Fire-and-forget**: multi-select color swatches below the existing single-select `ColorPaletteTag`; defaults to the item's current color tag. On click, adds a job to the queue.
- One Claude call returns `[{color, svg}]` JSON array using the same batch endpoint with mode `"color_variants"`
- Results reviewed in **QueuePanel**: cherry-pick grid. Each variant is named `{color}_{objectName}` (e.g., `blue_bowling_ball`) and inserted as a **new separate item** with `colorTag` set — they are NOT replacements of the original item.
- On Accept: loops through selected variants, calling `useSvgs.insertSvg` with `{ name, displayName, svgContent, colorTag }` for each

### Generation queue

[useGenerationQueue.js](src/hooks/useGenerationQueue.js) is a global sequential job queue. Flows B, C, and D all fire-and-forget into it; Flow A stays blocking because the user needs to type the item name.

- **Sequential processing**: one job runs at a time. When a job finishes, the next queued job starts automatically. At Sonnet prices this means a 3-job queue takes ~30-45 seconds total.
- **Job lifecycle**: `queued → generating → ready | error`. Ready jobs wait for the user to review in QueuePanel. Error jobs show the error with a Retry button.
- **Toast notifications**: "X ready — open Queue to review" on completion, "X failed" on error. Fires while the user is working on other items.
- **Header badge**: `Queue (1 running, 2 queued)` in blue, switches to green `(1 ready)` when results are available. Only shown when the queue has activity.
- **DetailModal inline status**: when the currently-open item has jobs in the queue, a blue info bar shows the count without blocking the modal.
- **State is ephemeral**: jobs live in React state only. Refreshing the browser clears the queue. The actual Claude call still happened (audit row exists in `generation_sessions`), but the result preview is lost. Acceptable for now.
- **QueuePanel**: [QueuePanel.jsx](src/components/QueuePanel.jsx) is a modal opened from the Header badge. Shows all jobs as expandable cards with status badges. Each job type has its own review UI: revise (SVG preview + Accept), batch (cherry-pick grid + Accept N), colors (cherry-pick grid with `{color}_{object}` naming + Accept N).

App.jsx holds **one `useGeneration`** instance (Flow A, blocking) and **one `useGenerationQueue`** instance (Flows B, C, D, fire-and-forget).

### Batch endpoint details

The `batch_generate_svg` Modal function and its HTTP wrapper live in [generate_svg.py](modal_functions/generate_svg.py). It:
- Shares the same `MODEL_TIERS`, system-prompt builder, and Supabase/Anthropic client setup as the single-object function
- Uses `max_tokens=32768` and `timeout=300` (vs 4096/120 for single)
- Claude returns a JSON array; `extract_json_from_response` tries direct parse, code-fence stripping, and bracket-extraction fallback
- Writes one `generation_sessions` audit row per batch call (the `response_svg` column stores the raw JSON response text for auditability)
- The proxy [api/batch-generate.ts](api/batch-generate.ts) validates mode (`category` | `color_variants`), model tier, and per-mode required fields, then forwards to `MODAL_BATCH_ENDPOINT_URL`

### System prompt categories

The `categories` array in [shared/system_prompt.json](shared/system_prompt.json) is the single source of truth for:
- The system prompt's `- Categories: ...` line (rendered by both JS and Python)
- The category dropdown in `BatchGenerateModal` (imported as `CATEGORIES` from [constants.js](src/lib/constants.js))

Adding a category to the JSON automatically updates both. Editing requires `modal deploy` for the Python side, same as any system prompt change.

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

All four flows let the user pick between two Claude models before firing a generation. The selector is a shared `<ModelTierToggle>` pill switch rendered in [GenerateNewModal.jsx](src/components/GenerateNewModal.jsx), [DetailModal.jsx](src/components/DetailModal.jsx), and [BatchGenerateModal.jsx](src/components/BatchGenerateModal.jsx).

| Tier       | Model ID              | Price (in/out per MTok) | When to use |
|------------|-----------------------|-------------------------|-------------|
| Standard   | `claude-sonnet-4-6`   | $3 / $15                | Default for all generations |
| Advanced   | `claude-opus-4-8`     | $5 / $25                | Escalate when Standard can't nail the SVG |

Behavior:

- The tier toggle **resets to Standard each time DetailModal opens a new item** (`useEffect` on `item.id`), so Advanced is never sticky across objects. Explicit opt-in per-call prevents accidental runaway Opus spend.
- The frontend sends `model_tier: "standard" | "advanced"` in the `/api/generate` POST body. The Vercel proxy validates against that allow-list before forwarding (defense in depth — don't trust an arbitrary string from the client).
- Modal's [generate_svg.py](modal_functions/generate_svg.py) defines `MODEL_TIERS` mapping each tier to `{ model, input_price_per_mtok, output_price_per_mtok }`. The function looks up the tier, uses its model id for the Anthropic call, and uses its pricing in the `cost_usd` audit column.
- The **UI intentionally does not label which model produced a given SVG** — Bill's call. The attribution lives in the database: `generation_sessions.model` records the resolved model id per call, so dev review can go through the table to see tier usage.
- Pricing constants in `MODEL_TIERS` are used only for the audit `cost_usd` column, not for real billing. Mild drift vs. Anthropic's actual prices is tolerable; update when they change.

To add/remove/rename a tier, edit both `MODEL_TIERS` in `generate_svg.py` AND the `ALLOWED_MODEL_TIERS` array in `api/generate.ts`, plus the `tiers` array in `ModelTierToggle.jsx`. All three must agree. (If this becomes a recurring chore, move the tier list to a shared JSON file alongside `shared/system_prompt.json`.)

### Collider generation

All generation flows (except Flow D) now ask Claude to return a `collider` object alongside the SVG. The collider schema, rules, and coordinate space are defined in `shared/system_prompt.json` under `colliderRules`.

**Response format change:** Single-object flows (A/B) now expect JSON `{"svg": "...", "collider": {...}}` instead of raw SVG. The Python `extract_svg_and_collider()` function handles this with graceful fallback to raw-SVG-only if Claude doesn't return JSON (e.g., older cached prompts).

**Per-flow behavior:**
- **Flow A** (Generate one): collider baked into `physical_properties` on INSERT (single DB write)
- **Flow B** (Revise existing): collider saved to the **parent** item (or self if root) via `updatePhysicalProperties` after the SVG update
- **Flow C** (Batch by category): collider baked into each item's `physical_properties` on INSERT
- **Flow D** (Color variants): no collider generated — inherits from parent

**Programmatic fallback:** The DetailModal "Generate" button in the Collider section runs a client-side programmatic generator (`colliderGenerator.js`) that extracts vertices from SVG elements, computes a convex hull, and simplifies to ≤8 vertices. No LLM call. Useful for existing SVGs that pre-date the LLM collider feature, or when the LLM's collider needs correction.

**Collider editor:** The DetailModal also has an interactive vertex editor (drag to move, click + to add, click × to remove) for fine-tuning colliders manually. Convexity is checked live with an amber warning if the polygon becomes concave.

> **Direction note (planned, not shipped):** colliders are **convex-only today**, but the downstream gist repo's concave-collider refactor (Phase 0 SHIPPED there) means this repo will gain a **concave outer-boundary outline** path — the generator will emit the true concave silhouette labeled `type:"convex"` (gist decomposes it into a `compound` at load via `poly-decomp`; we do NOT add that dependency here). The amber "concave is forbidden" warning above will flip to "concave → decomposed downstream." See **Dev_Tasks.md → Task 12** and [../gist/Notes_on_Concave_Colliders_Refactor.md](../gist/Notes_on_Concave_Colliders_Refactor.md). The key blocker is ordered outer-boundary extraction (the current generator hulls an unordered point cloud); the chosen approach is vector polygon union, not bitmap tracing.

### Collider Lab

A dedicated **`Collider Lab`** tab (third tab in [TabStrip.jsx](src/components/TabStrip.jsx), alongside SVG Manager + Data Transforms) that pulls collider review out of the cramped DetailModal into a spatial audit/triage surface. **Task 13 — Phase 1 of 4 shipped (read-only).** The remaining phases (editing, polygon generation, pill editor) are in [Dev_Tasks.md](Dev_Tasks.md).

- **A view over existing data — no schema change.** Reads `useSvgs` items, writes (in later phases) via the existing `updatePhysicalProperties`. Gated behind `needsLibrary` in [App.jsx](src/App.jsx) so it loads the library like the SVG tab.
- **Grouping is an EXTENSIBLE facet.** [ColliderLab.jsx](src/components/ColliderLab.jsx) buckets items via a `facet` object (`{ groups[], bucketOf() }`). Phase 1 ships the **shape facet** (circle / box / polygon=`convex` / compound / none). Bill's planned **physics-perspective facets** slot in as additional facet objects — no rewrite. Children (variants) and `idea_only` concepts are excluded.
- **Polygon group = stored `type:"convex"`** (the accepted-concave misnomer). A **"concave" badge** (detected via `isConvexPolygon`) flags closed concave outlines (cups/wagons) that gist will decompose downstream.
- **Ground-truth inspector** ([ColliderGroundTruth.jsx](src/components/ColliderGroundTruth.jsx)): three aligned layers (icon → coordinate grid → collider overlay) in an **aspect-correct box, so non-square rescaled viewBoxes align with no letterboxing** — this sidesteps the `ColliderEditor` 64×64-hardcode bug. Reuses `ColliderPreview` + `GeometryInfo`, plus a monospace coordinate readout.
- **Reveals out-of-bounds colliders.** When a collider's vertices fall outside 0–W/0–H, the coordinate space **expands with a gutter** (instead of clipping at the edge): extended gridlines + labels, the real viewBox boundary drawn, red markers on off-canvas vertices, an amber warning quantifying the overflow per edge, and `⚠` flags in the readout. This surfaced a real data-quality issue — several seeded colliders (e.g. `dynamics_cart`, `fire_truck`, `flat_asteroid`) have vertices below the viewBox. Fixing them is Phase 2 (editing) motivation.

### Parent-child relationships (color variants)

Color variants point to their canonical parent via `physics_svgs.parent_id` (self-referencing FK, added in migration 11c). Design rules:

1. **One level only.** Variants always point to a root parent, never to another variant. If generating variants from a variant, `parent_id` resolves to the root.
2. **Always inherit.** Children never store their own `physical_properties` — the frontend reads from the parent at display time via `item.effectivePhysicalProperties`.
3. **Flat grid.** All items are visible in the grid. Parents show color dots (bottom-left) for their variants. Children show `↑ parent_name` (bottom-left).

**Schema:** `parent_id uuid REFERENCES physics_svgs(id) ON DELETE SET NULL`. The `svgs_with_details` view joins to `physics_svgs parent` to return `parent_name`.

**Frontend:** `addVariantInfo()` runs after loading all items — populates `item.variants[]` on parents and `item.effectivePhysicalProperties` on all items. `updatePhysicalProperties` optimistically propagates changes to all children.

**Manifest export:** Each item's `physical_properties` in the manifest uses `effectivePhysicalProperties` (inherited from parent for children). A `parent` field is included so GIST knows which items are variants of the same physics object.

**Backfill:** Existing variants are linked manually via SQL. Pattern:
```sql
UPDATE physics_svgs SET parent_id = (SELECT id FROM physics_svgs WHERE name = '<parent>')
WHERE name IN ('<color>_<parent>', ...) AND parent_id IS NULL;
```

## Trash (soft delete) and rename

Both features live in [useSvgs.js](src/hooks/useSvgs.js) (mutations), [DetailModal.jsx](src/components/DetailModal.jsx) (rename + trash buttons), [TrashPanel.jsx](src/components/TrashPanel.jsx), and the Header `Trash (N)` button. Schema is migration **11d** in [gist-supabase-schema.sql](gist-supabase-schema.sql) (run by Bill 2026-06-24).

**Soft delete, not hard delete.** Trashing sets `physics_svgs.deleted_at`/`deleted_by` instead of removing the row. `useSvgs.refresh()` splits rows: active (`deleted_at is null`) go into `items`, trashed go into a separate `trashedItems` list. **Because trashed rows are excluded from `items`, every existing consumer — the grid, export scope, `existingNames` collision checks, `addVariantInfo` inheritance — automatically ignores them with no extra filtering.**

**Names are unique among ACTIVE items only.** Migration 11d drops the global `unique (name)` constraint and replaces it with a partial unique index `physics_svgs_name_active_key on (name) where deleted_at is null`. Filesystem semantics: trashing frees the name instantly (you can immediately create a new `wheel`), multiple trashed rows may share a name, but only one active row per name (DB-enforced). Collision checks (creation, rename, restore) compare against active names only.

**Restore with rename-on-collision.** Restore is keyed by `_uuid` (trashed names can collide, so `id` is not unique in the trash). If the original name is still free, it restores as-is; if an active item now holds that name, [TrashPanel.jsx](src/components/TrashPanel.jsx) makes the user type a NEW slug before restoring. **We never auto-suffix to something like `wheel_old`** — the `name`/slug is semantic input the downstream GIST LLM uses to pick objects per the teacher's prompt, so a junk slug degrades selection. See [[project_gist_pipeline]].

**Cascade to variants.** Trash/restore/permanent-delete on a **parent** cascade to its color variants (children always inherit physical_properties, so they move as a set). `trashSvg` does it in one `.or("id.eq.X,parent_id.eq.X")` UPDATE; DetailModal confirms with the variant count first.

**RLS permission split (no new policies needed):** trash/restore are UPDATEs → editors allowed; permanent delete is a DELETE → owners only (existing "Owners can delete SVGs" policy). On permanent delete, `svg_versions`/`svg_feedback` cascade and `generation_sessions.svg_id` nulls (audit preserved).

**Rename changes BOTH the slug (`name`/`item.id`) and the display label (`display_name`).** In DetailModal the **slug is the primary, autofocused field**; the display label auto-follows it (underscores → spaces, matching how `insertSvg` derives display names) until the user edits the label directly. Because the slug IS `item.id` (the React key + the open modal's selector), `renameSvg` is DB-first and calls an `onRenamed(newId)` callback so App re-points `modalItemId` in the same render tick — never a frame where the modal's id matches no item. Renaming a parent doesn't break variant links (those are by UUID); children's `parentId` label is patched locally.

## Modal secrets and env vars (Bill-specific naming)

These names diverged from the original plan in CLAUDE.md after Bill set them up. Use these:

| Modal secret name           | Env vars exposed inside the function           |
|-----------------------------|-----------------------------------------------|
| `anthropic-api`             | `ANTHROPIC_API_KEY`                           |
| `supabase_for_svg_gen`      | `SUPABASE_DATA_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

The function references both via `modal.Secret.from_name(...)` in [modal_functions/generate_svg.py](modal_functions/generate_svg.py).

> **Key format note:** `SUPABASE_SERVICE_ROLE_KEY` currently holds the **legacy `service_role` JWT** (`eyJ…`), which Supabase has deprecated (legacy keys deleted late 2026). The browser side already uses the new `sb_publishable_…` format; the Modal server side has **not** migrated to `sb_secret_…` yet. The `supabase==2.28.3` pin is the prerequisite (it accepts non-JWT keys); the actual key swap is **Dev_Tasks.md task 11**. Don't assume the migration is done.

## Vercel env vars — important behavior

`vercel dev` reads env vars from the **linked Vercel project's dashboard first**, NOT from `.env.local`. If the project dashboard has nothing, the function gets `undefined` even when `.env.local` is populated.

This caused a long debugging session at the end of Task 7. The fix is to put the same three vars in the Vercel project at `development` scope:

```bash
vercel env add VITE_SUPABASE_URL development
vercel env add VITE_SUPABASE_ANON_KEY development
vercel env add MODAL_ENDPOINT_URL development
vercel env add MODAL_BATCH_ENDPOINT_URL development
```

Verify with `vercel env ls`. **For Task 9 (production deploy)**, repeat with `production` scope.

The browser-side Vite app reads from `import.meta.env.VITE_*` at build time, which DOES use `.env.local`. So `.env.local` is still load-bearing for the React app — the Vercel-dashboard requirement is only for the `api/` function process.

## System prompt — single source of truth

The Claude generation prompt lives in **[shared/system_prompt.json](shared/system_prompt.json)**. Both runtimes read the same file:

- [src/lib/constants.js](src/lib/constants.js) — `buildSystemPrompt(items)` imports the JSON at build time and renders it for the SystemPrompt overlay
- [modal_functions/generate_svg.py](modal_functions/generate_svg.py) — `build_system_prompt(library_names)` reads `/root/system_prompt.json` from inside the Modal container and renders it for actual Claude calls

Shape: `{ header, rules[], colliderRules[], categories[], librarySection }`. Both renderers prefix each rule with `- ` and substitute `{count}` and `{names}` in `librarySection`. `colliderRules` are rendered under a "Collider rules:" heading. If you change the JSON shape (not the content), update both renderers in lockstep.

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
