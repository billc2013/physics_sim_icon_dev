# Dev Tasks

Prioritized backlog for migrating the GIST Physics SVG Asset Manager from a single Claude.ai artifact into a deployed full-stack app.

> **Note:** This file (and CLAUDE.md) is gitignored — working notes for Bill and Claude only, not committed to the repo.

See [CLAUDE.md](CLAUDE.md) for working conventions, repo state, and the schema-vs-item-shape mapping. See [overview_April_7.md](overview_April_7.md) for full architectural context.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Snapshot

Done locally:
- ✓ Tasks 1, 2, 3, 6, 7, 8
- ✓ Task 10 zip export (shipped ahead of Task 9; production walkthrough still pending)
- ✓ Batch generate by category (Flow C) + color variant generation (Flow D)
- ✓ Generation queue: Flows B, C, D are fire-and-forget with sequential processing and QueuePanel review
- ✓ Color variants insert as NEW items named `{color}_{objectName}` with `colorTag` set
- ✓ Task 8 keep_alive cron (modal_functions/keep_alive.py, Sunday 06:00 UTC)
- ✓ Collider system: schema + validation, programmatic SVG→collider generator, interactive vertex editor, LLM-generated colliders on Flows A/B/C
- ✓ Parent-child parenting: `parent_id` column, always-inherit physical_properties, color dots on parent cards, ↑parent on variant cards, manifest uses effectivePhysicalProperties

Remaining:
- Tasks 4, 5, 9, and the production-walkthrough piece of 10

The app works end-to-end on `vercel dev` (login → grid → review → four generate flows with queue + collider generation → audit log → manual download/upload → zip export with manifest + colliders). What's missing is multi-user (Realtime), production deploy, Duncan's bootstrap, and the prod walkthrough of the zip export.

**Batch generation + queue requires:**
- `modal deploy modal_functions/generate_svg.py` (deploys the new `batch_generate_svg_http` endpoint)
- `vercel env add MODAL_BATCH_ENDPOINT_URL development` (the URL printed by `modal deploy` for the batch endpoint)

**Suggested next-task order from here:**
1. **Task 9** (deploy) — unlocks Duncan signing up via the production URL AND unblocks the remaining production-walkthrough piece of Task 10
2. **Task 4** (insert Duncan into project_members) — 10-second SQL after he signs up
3. **Task 5** (Realtime) — multi-user live sync, biggest UX win once Duncan is in
4. Finish **Task 10** prod walkthrough

---

## Phase 1 — Foundation

### 1. Initialize git repository `[x]`

Done. Initial commit `dd008e5 initial commit`.

---

### 2. Vite + React scaffold and decompose the monolithic .jsx `[x]`

Done. Commit `e89d109 First major commit -- Vite scaffold + decompose initial single file proof of concept`.

What landed:
- `npm create vite@latest .` with React + JS template, `npm install`, `npm run dev/build/preview` all work
- Decomposed into `src/{App.jsx, components/, hooks/, lib/}` per the structure in [CLAUDE.md](CLAUDE.md#actual-file-structure)
- Inline styles preserved verbatim; theme variables added to `index.css`
- Cryptic short names expanded (`SC` → `STATUS_CONFIG`, etc.)
- localStorage bridge replaced `window.storage` (later removed in Task 3)
- All artifact behaviors preserved (filter solo, idea-only modal, search, color tagging)

Note: `gist-svg-manager.jsx` is still on disk as reference. Original Task 3 plan said to delete it; Bill kept it.

---

### 3. Wire Supabase, ship login UI, seed the database, and build the Modal generate_svg() function `[x]`

Done. Commit `18a61f4 Phase 3 Done -- login, supabase integration, auth, modal pipeline tested`.

What landed:
- `@supabase/supabase-js` installed; singleton client in [src/lib/supabase.js](src/lib/supabase.js)
- [src/hooks/useAuth.js](src/hooks/useAuth.js) — session state, sign in/up/out
- [src/components/LoginPage.jsx](src/components/LoginPage.jsx) — minimal email/password gate
- [src/hooks/useSvgs.js](src/hooks/useSvgs.js) — loads `svgs_with_details` view + `svg_feedback` rows in parallel, transforms into the artifact's item shape, exposes optimistic mutations
- localStorage bridge removed
- In-memory undo stack dropped (DB-side history via `archive_svg_version` trigger is the replacement)
- [scripts/seed.js](scripts/seed.js) — Node script seeded all 50 SVGs with `created_by = Bill's auth.users.id`
- Bill bootstrapped into `project_members` as owner via SQL editor
- [modal_functions/generate_svg.py](modal_functions/generate_svg.py) — Modal function deployed and verified via `modal run`
- Modal secrets created with names that diverged from the original plan: `anthropic-api` and `supabase_for_svg_gen` (env vars `ANTHROPIC_API_KEY`, `SUPABASE_DATA_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- First end-to-end test: generated a `football` SVG via `modal run`, then promoted manually with SQL — exercised the version-archive trigger successfully

Discoveries (now reflected in CLAUDE.md):
- The `feedback_with_author` view drops `author_id`, so `useSvgs` reads raw `svg_feedback` rows directly. Switch to the view in a later task when we want to display "Duncan said..." attribution.
- The `useFeedback.js` hook from the original plan got rolled into `useSvgs.js` because feedback is part of the item shape — splitting them would have meant maintaining two parallel shapes through every component.

---

### 4. Insert Bill and Duncan into `project_members` `[~]`

Bill is in. Duncan is not yet.

**Remaining scope**
- After Duncan signs up via the deployed production URL (waits on Task 9), grab his `auth.users.id` from the Supabase auth dashboard
- Run a one-line `INSERT INTO project_members (user_id, display_name, role) VALUES (...)` snippet in the Supabase SQL editor with role `owner`
- Verify Duncan can read `physics_svgs` from the deployed app

**Acceptance**
- Two owner rows in `project_members`
- Both users see the seeded grid in their browsers

---

## Phase 2 — Realtime sync

### 5. Add Realtime subscriptions to `useSvgs` `[ ]`

Deferred from Task 3 to keep that PR scoped. Now blocking the multi-user UX (without it, Bill and Duncan see stale data until they refresh).

**Scope**
- Subscribe to `postgres_changes` on `physics_svgs` and `svg_feedback` inside `useSvgs.js`
- Reconcile incoming events with local state. **Be aware of the item-shape transform:** events arrive as raw schema rows, but local state holds shaped items with `_uuid`, joined `colorTag`, embedded `feedback[]`, etc. Two reasonable approaches:
  - **(a)** Re-call `refresh()` on any incoming event. Simple, slightly wasteful, fine for 50–100 items.
  - **(b)** Patch local state surgically by mapping the raw row through `shapeItem()`. Requires fetching the joined view row separately, since `postgres_changes` returns the base table row not the view row. More work.
- Consider how Realtime interacts with the **optimistic update** pattern in `useSvgs`. When my own UPDATE comes back to me as a Realtime event, I shouldn't double-apply it. Two options:
  - Diff against current state and skip no-op patches
  - Track an "in-flight" set keyed by `(table, id)` and ignore events for those rows
- Handle subscription cleanup on unmount and on auth changes (sign out should close all channels)
- Verify two browser windows logged in as different users see live updates

**Out of scope**
- Realtime presence ("Duncan is viewing this item") — backlog
- Conflict resolution beyond last-write-wins — backlog

**Acceptance**
- Two-window test: status change, color change, feedback post, notes edit, accept-revision all propagate without refresh
- Subscriptions don't leak across logout/login (no zombie channels in the Supabase dashboard's Realtime metrics)
- The in-flight Bill-typing-into-the-textbox case doesn't get clobbered by his own UPDATE round-tripping back

---

## Phase 3 — Generation pipeline

### 6. Build Vercel serverless proxy `api/generate.ts` `[x]`

Done. Commit `3637657 modal set-up; web feature for updating and creating svgs with llm call enabled`.

What landed:
- [api/generate.ts](api/generate.ts) — TypeScript Node function
- Validates Supabase JWT from `Authorization: Bearer ...` header by calling `supabase.auth.getUser(jwt)`
- **Injects** `requested_by` from the validated user (overrides whatever the client sent)
- Forwards JSON body to `MODAL_ENDPOINT_URL`
- Returns 401 / 400 / 502 / 500 with structured error messages
- `@vercel/node` installed as a devDep for type definitions
- Improved error message at the end of the dev session reports *which specific* env vars are missing rather than a generic "misconfigured"

Discoveries (now reflected in CLAUDE.md):
- `vercel dev` reads env vars from the linked **Vercel project's dashboard first**, not `.env.local`. Populating `.env.local` alone is not enough — you have to also `vercel env add ... development` for each var. This took ~30 minutes to debug.
- Modal endpoint URLs that look like `https://modal.com/apps/<workspace>/main/deployed/<app>` are the **dashboard URLs**, NOT the function endpoint. The real endpoint is `https://<workspace>--<app>-<function-with-hyphens>.modal.run` and is printed by `modal deploy`.

---

### 7. Build the GeneratePanel UI — two flows `[x]`

Done. Same commit as Task 6.

What landed:
- [src/hooks/useGeneration.js](src/hooks/useGeneration.js) — state machine: `idle → generating → ready/error`. App holds two instances (`newGeneration`, `reviseGeneration`) so the two flows don't collide.
- [src/components/GenerateNewModal.jsx](src/components/GenerateNewModal.jsx) — Flow A overlay, name input + color picker + preview + accept/discard. Includes name normalization (lowercase + snake_case) and collision detection against `existingNames`.
- [src/components/DetailModal.jsx](src/components/DetailModal.jsx) extended with an inline "Revision preview" panel for Flow B. "Send to Claude" button now wires to a real handler and disables during generation.
- [src/hooks/useSvgs.js](src/hooks/useSvgs.js) gained `insertSvg` (Flow A accept) and `updateSvgContent` (Flow B accept) mutations. Both set `created_by`/`updated_by` correctly so the version-archive trigger attributes prior versions to the right user.
- [.env.local.example](.env.local.example) updated with `MODAL_ENDPOINT_URL`
- [modal_functions/generate_svg.py](modal_functions/generate_svg.py) gained `@modal.fastapi_endpoint` HTTP wrapper that calls `generate_svg.local(...)` internally — preserves the `modal run` test path

Verified end-to-end via `vercel dev`:
- Flow A: typed `coffee_mug`, generated, accepted → new draft card appeared in grid, row in `physics_svgs`, row in `generation_sessions`
- Flow B: opened `bowling_ball`, sent to Claude, accepted → version bumped, prior version archived to `svg_versions`, status promoted draft→revised
- Collision path: typing `football` disabled the Generate button and offered "Open it to revise" jump

**Note for Task 5:** The optimistic update pattern in `useSvgs` needs to play nicely with Realtime — see notes there.

---

### 8. Build Modal `keep_alive()` weekly cron `[x]`

Done. File: `modal_functions/keep_alive.py`.

What landed:
- Separate Modal app (`gist-keep-alive`) with a single `keep_alive` function
- Schedule: `modal.Cron("0 6 * * 0")` — every Sunday at 06:00 UTC (matches the pg_cron fallback in the schema)
- Reuses the existing `supabase_for_svg_gen` Modal secret — no new secret needed
- Updates the `heartbeat` singleton row (`id = 1`) with `last_ping = now()`
- Includes a `modal run` local entrypoint for manual testing
- Lightweight image: only `supabase==2.9.1`, no Anthropic dependency

Deploy: `modal deploy modal_functions/keep_alive.py`
Test:   `modal run modal_functions/keep_alive.py`

The schema (section 8) also has a `pg_cron` job that does the same update, but `pg_cron` can't fire if the project is already paused. The Modal cron is the external watchdog that prevents the pause from happening in the first place.

---

## Phase 4 — Deploy & polish

### 9. Push to GitHub and set up Vercel auto-deploy `[ ]`

This unblocks Duncan signing up (Task 4). Probably the most "yak shaving for the value" task in the backlog.

**Prerequisites**
- Bill has a GitHub account and can create a new repo
- The Vercel project is already linked locally (`.vercel/project.json` shows `bill-churchs-projects/physics-sim-icon-dev`)

**Scope**
- Create GitHub repo (Bill creates it via UI; Claude provides the `git remote add` + push commands)
- Decide what to commit vs. what stays local-only:
  - Currently gitignored: `CLAUDE.md`, `Dev_Tasks.md`, `.env*`, `gist-supabase-schema.sql`. Confirm Bill wants this state for the public repo, or pull the schema back in.
  - Add `__pycache__/` to gitignore if not already (Modal creates these locally)
  - Decide whether `.env.local.example` should be committed (it's a useful onboarding doc with no secrets — recommend unignoring it for the deploy)
- Push `main` to GitHub
- Connect the GitHub repo to Vercel (already linked locally so this should be a few clicks in the dashboard)
- **Configure Vercel env vars at `production` scope** (NOT just `development`):
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `MODAL_ENDPOINT_URL`
  - Use `vercel env add <name> production` from the CLI for each
- Possibly add `vercel.json` if a rewrite/header is needed (probably not)
- Verify push to `main` triggers a deploy
- Smoke-test the production URL: sign up as Duncan, sign in as Bill, generate something, accept it

**Out of scope**
- GitHub Actions / CI beyond Vercel's built-in
- Branch protection, code review requirements
- Custom domain (use the default `*.vercel.app` URL for now)

**Acceptance**
- Production URL works end-to-end with auth, generation (both flows), and persistence
- Pushing to `main` redeploys automatically
- Duncan can sign up via the production URL (Task 4 then unblocks)

---

### 10. End-to-end test + zip export of approved SVGs `[~]`

**Zip export: done locally.** Shipped ahead of the Task 9 deploy because it turned out to be a useful standalone feature.

What landed:
- Schema: four new nullable columns on `physics_svgs` — `last_exported_at`, `last_exported_version`, `last_exported_by`, `physical_properties` (jsonb). Added to [gist-supabase-schema.sql](gist-supabase-schema.sql) section 11a as an idempotent `alter ... if not exists` block; table definition and `svgs_with_details` view also updated inline. Migration run by Bill on 2026-04-08.
- Section 11b follow-up migration: `mark_svgs_exported(uuid[])` RPC (server-side stamp). See "Stale-detection fix" below for why. Migration run by Bill on 2026-04-09 and verified in both the stale-dot and new-or-updated-scope paths.
- `jszip@3.10.1` installed as a direct dep
- [DownloadApprovedModal.jsx](src/components/DownloadApprovedModal.jsx) — dialog with scope radio (new-or-updated vs all-approved, counts inline) + manifest checkbox (default on). Gated `Download` button when the selected scope is empty. Scope filter uses the shared `needsExport(item)` helper from [useSvgs.js](src/hooks/useSvgs.js).
- `useSvgs.markExported(uuids)` — calls the `mark_svgs_exported` RPC so `updated_at` and `last_exported_at` end up equal within one server transaction.
- JSZip-based zip build in `handleConfirmDownload` (App.jsx). Zip filename `physics-sim-svgs-YYYY-MM-DD.zip`. Manifest shape is `{ manifest_version: 1, exported_at, exported_by, export_mode, items: [...] }` emitting `physical_properties` for each item.
- Grid stale-export dot in [SvgCard.jsx](src/components/SvgCard.jsx) (amber 8px, bottom-right) driven by the shared `isStale(item)` helper.
- Exported-as line in [DetailModal.jsx](src/components/DetailModal.jsx) reading `Exported as v3 · 2026-04-09 · Bill` with `(changes since)` in amber when `isStale(item)` is true.
- [FilterBar.jsx](src/components/FilterBar.jsx) gained a `Downloaded (N)` toggle that intersects with the status filter.
- All five `physics_svgs`-touching mutations in `useSvgs.js` now chain `.select("version, updated_at").single()` and flow the server values back into local state via the `optimisticUpdate` post-patch contract.

**Stale-detection fix (2026-04-09, verified working):** the initial v1 used `version > lastExportedVersion` as the stale predicate. Two bugs surfaced during Bill's first real export:
1. Uploading a replacement SVG bumped version in the DB via the archive trigger, but the optimistic update in `updateSvgContent` didn't propagate the new version back to local state — so the dot and dialog were wrong until the next browser refresh.
2. Color-tag changes don't bump version at all (the archive trigger only fires on content/status). But `color_tag` IS in the manifest, so those changes should re-export.

Fix (shipped and verified by Bill): switched the stale predicate to `updatedAt > lastExportedAt` via the shared `isStale(item)` / `needsExport(item)` helpers; added migration 11b so `updated_at` and `last_exported_at` get set to the same transaction-local `now()` inside the server-side RPC (a client-supplied ISO string would diverge from moddatetime's server timestamp by the round-trip latency and falsely mark just-exported items as stale); refactored all `physics_svgs` mutations to chain `.select("version, updated_at").single()` and return those values via the new `optimisticUpdate` post-patch path so the client reflects the real server values immediately. Both the upload-content-revision case and the color-change case now correctly mark items stale without a browser refresh, and just-exported items correctly do NOT appear stale.

**Remaining scope (deferred until Task 9 deploy)**
- Walk through a full session against the **production URL** (not just localhost): log in, generate, revise, approve, download. Verifies Vercel prod env vars, Supabase RLS from a non-localhost origin, and the real-world cold-start feel of Modal.
- Consider whether we want a `feedback-log.json` in the zip too, like the original artifact's design. Not obviously useful since the physics pipeline doesn't consume feedback, so let's punt unless Duncan asks.

**Out of scope**
- Per-status export, per-color export — backlog
- Server-side zip generation — pointless for ~50 small SVGs

**Acceptance (local)**
- ✓ Zip downloads from localhost
- ✓ Contains valid SVG files named with snake_case from `physics_svgs.name`
- ✓ manifest.json present when the checkbox is on and carries `physical_properties`
- ✓ `last_exported_*` columns stamp correctly via RPC
- ✓ Stale dot / changes-since line appear after a post-export content revision (upload path) without a browser refresh
- ✓ Stale dot / changes-since line appear after a post-export color-tag change without a browser refresh
- ✓ Just-exported items do NOT immediately flag as stale
- ☐ Same, from production URL (waits on Task 9)

---

## Completed off-task-list work

### Collider system (2026-04-12) `[x]`

What landed:
- **Collider schema** (`src/lib/colliderSchema.js`): types (circle, box, convex ≤8 verts, compound), validation, `colliderToEditableVertices()`, `isConvexPolygon()`
- **Programmatic generator** (`src/lib/colliderGenerator.js`): SVG → collider via DOMParser + convex hull (Andrew's monotone chain) + RDP simplification. Zero dependencies. Detects circles/boxes, falls back to convex polygon.
- **ColliderPreview** (`src/components/ColliderPreview.jsx`): static blue dashed SVG overlay for all collider types
- **ColliderEditor** (`src/components/ColliderEditor.jsx`): interactive polygon editor — drag vertices, click + to add on edges, click × to remove. Live convexity warning. Pointer capture for smooth drag. Coordinate mapping via `SVGSVGElement.getScreenCTM()`.
- **DetailModal collider section**: Generate/Edit/Save/Remove/Show/Hide controls. Edit mode swaps preview for editor. Inheritance display for children ("inherited from {parent}"). Saves target the parent item for children.
- **LLM-generated colliders**: system prompt includes `colliderRules`. Flows A/B/C return `{"svg", "collider"}` from Claude. Flow D skipped (inherits from parent). `extract_svg_and_collider()` in Python with graceful fallback.
- **`useSvgs.updatePhysicalProperties`** mutation with optimistic update that propagates to children's `effectivePhysicalProperties`. `insertSvg` accepts optional `physicalProperties` for atomic insert+collider in Flows A/C.

### Parent-child parenting for color variants (2026-04-12) `[x]`

What landed:
- **Schema migration 11c**: `parent_id uuid REFERENCES physics_svgs(id)` self-referencing FK + index. View updated with `parent_name` join.
- **useSvgs item shape**: new fields `parentId`, `_parentUuid`, `variants[]`, `effectivePhysicalProperties`. `addVariantInfo()` computes inheritance after loading.
- **Flow D**: `insertSvg` sets `parent_id` on color variant insert. One-level-only rule enforced (if source is itself a child, uses its parent).
- **SvgCard**: color dots (from COLOR_RAMPS) on parent cards bottom-left. `↑ parent_name` text on variant cards.
- **Manifest export**: uses `effectivePhysicalProperties` (inherited) + `parent` field per item.
- **Manual backfill**: SQL template in migration 11c-backfill.

---

## Backlog / nice-to-have (not yet scheduled)

- **Restore-previous-version UI** built on `svg_versions`. Replaces the in-memory undo we dropped in Task 3.
- **Diff viewer** between `svg_versions` entries (visual side-by-side or text diff of the SVG markup).
- **Realtime presence** ("Duncan is viewing wooden_block right now").
- **Author attribution on feedback** — switch `useSvgs` from raw `svg_feedback` reads to the `feedback_with_author` view and surface "Duncan said..." in the feedback history block. (Currently we don't because the view drops `author_id`.)
- **Tailwind migration** if/when inline styles become painful.
- **Keyboard shortcut overlay** (`?` to view bindings).
- **Bulk approve / bulk re-tag color.**
- **Per-user "favorites" or "needs my review" filter.**
- **Export to Planck.js-compatible JSON manifest** (different shape than the raw zip — feeds the simulation pipeline directly).
- **ESLint + Prettier config standardization** (current config is Vite default + Bill's tweaks).
- **Vitest test setup** once the surface is stable.
- **Move the system prompt to a single source of truth** (shared `.txt` file or Supabase config table) once it starts changing frequently. Currently duplicated in JS and Python with a comment reminder.
- **Streaming generation responses** (Modal SSE → Vercel SSE → React EventSource). Cooler UX than the current 5–15s spinner. Deferred from Task 7.
- **Delete the `GeneratePanel.jsx` stub** left over from Task 2 (Flow A is in `GenerateNewModal.jsx` instead).
- **Delete `gist-svg-manager.jsx`** once it's no longer useful as reference.
- **Queue persistence across page refreshes.** Currently the generation queue lives in React state — refreshing the browser clears all pending/ready jobs. The Claude call still happened (audit row in `generation_sessions`), but the result preview is lost. Two possible fixes: (a) persist the queue to localStorage and rehydrate on load, (b) build a "pending results" view that reads `generation_sessions` rows with `status = 'completed'` and no corresponding `physics_svgs` update. Either works; (a) is simpler for the common "I accidentally refreshed" case, (b) is more robust for "I closed the tab and came back tomorrow." Low priority — the queue processes fast and Bill typically reviews results within minutes.
- **Review: "Pick" color variant sets both SVG content AND color tag.** Currently, picking a color variant in Flow D updates the SVG content and also sets the color tag to match. This keeps the manifest's `color_tag` field accurate, but couples two operations that might warrant separate control. If Bill/Duncan find cases where they want to apply a color-variant SVG but NOT change the tag metadata, we can decouple the two writes behind a checkbox or a separate "Apply SVG only" button. Low priority — watch for friction signals.
- **Physical-properties editor in DetailModal (non-collider fields).** The collider UI is done (generate, edit, save). The remaining `physical_properties` fields (`mass_kg`, `length_m`, `width_m`, `notes`) still need a small form in DetailModal. The `useSvgs.updatePhysicalProperties` mutation already exists — just needs UI inputs wired to it.
- **Modal-side defense in depth:** add `requires_proxy_auth=True` to `generate_svg_http` and rotate Modal API tokens through Vercel. Currently relies on URL secrecy.
- **Sanitize Claude-generated SVGs through DOMPurify too.** Manual uploads in DetailModal already get sanitized via DOMPurify (`USE_PROFILES: { svg: true, svgFilters: true }`) before being staged in `pendingUpload`. Claude output still flows directly into `dangerouslySetInnerHTML` without sanitization, which is inconsistent. The fix is small: pipe `useGeneration` results through the same sanitizer before exposing them on the preview, OR sanitize at render time inside the Card/Modal components. Either is fine; pick one place. Claude is unlikely to inject XSS into an SVG, but "trust no input at the boundary" is the right default.
- **Inkscape namespace handling on upload.** Inkscape adds `inkscape:` and `sodipodi:` namespaced elements/attributes to its saved SVGs (editor metadata, not graphics). DOMPurify in default SVG mode may strip these as non-standard, which would fire the "something was removed" warning on every Inkscape upload — even though the visible drawing is unaffected. If this turns out to be noisy in practice, allow-list those namespaces via DOMPurify's `ADD_TAGS` / `ADD_ATTR` or a custom hook so the warning only fires for actual security strips. Don't pre-optimize: ship the simple version, see whether real Inkscape uploads trigger the warning routinely, and only then add the allow-list.
