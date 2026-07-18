# Dev Tasks

Prioritized backlog for migrating the GIST Physics SVG Asset Manager from a single Claude.ai artifact into a deployed full-stack app.

> **Note:** This file (and CLAUDE.md) is git-tracked — working notes shared between Bill and Claude, committed to the repo as the running project state across sessions.

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
- Tasks 4, 5, 9b, 11, and the production-walkthrough piece of 10 (9a — GitHub push — is done)
- Task 11 (Supabase `sb_secret_` key migration) has a real external deadline: legacy keys deleted late 2026

The app works end-to-end on `vercel dev` (login → grid → review → four generate flows with queue + collider generation → audit log → manual download/upload → zip export with manifest + colliders). What's missing is multi-user (Realtime), production deploy, Duncan's bootstrap, and the prod walkthrough of the zip export.

**Batch generation + queue requires:**
- `modal deploy modal_functions/generate_svg.py` (deploys the new `batch_generate_svg_http` endpoint)
- `vercel env add MODAL_BATCH_ENDPOINT_URL development` (the URL printed by `modal deploy` for the batch endpoint)

**Suggested next-task order from here:**
1. **Task 9b** (Vercel auto-deploy) — unlocks Duncan signing up via the production URL AND unblocks the remaining production-walkthrough piece of Task 10. *Deferred by Bill for now — still testing on localhost.*
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

### 9. Push to GitHub (9a) and set up Vercel auto-deploy (9b)

Splits into two: 9a (GitHub) is **done**; 9b (Vercel auto-deploy) is **deliberately deferred** while Bill keeps testing on localhost.

#### 9a. Push to GitHub `[x]`

Done. The repo is public on GitHub (public since 2026-06-23). Decision on what to commit was resolved: `CLAUDE.md`, `Dev_Tasks.md`, and `gist-supabase-schema.sql` are all now **git-tracked** (previously local-only). `.env*` stays gitignored. `.env.local.example` remains untracked (Bill's call).

#### 9b. Set up Vercel auto-deploy from `main` `[ ]`

**Deferred deliberately** — Bill is still testing on his local machine and isn't ready for a production URL / auto-deploy yet. This still unblocks Duncan signing up (Task 4) once it lands.

**Prerequisites**
- The Vercel project is already linked locally (`.vercel/project.json` shows `bill-churchs-projects/physics-sim-icon-dev`)
- Add `__pycache__/` to gitignore if not already (Modal creates these locally)

**Scope**
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

### 11. Migrate Modal service-role key to the new `sb_secret_` format `[ ]`

Supabase has deprecated the legacy JWT-based API keys (`anon`, `service_role`). The
browser side already uses the new `sb_publishable_…` publishable key, but the
**server side still holds the legacy `service_role` JWT** in the `supabase_for_svg_gen`
Modal secret. Researched against the Supabase docs on 2026-06-24.

**Why this matters (the real wins, not just deprecation):**
- **Hard deadline:** legacy `anon`/`service_role` keys are deleted **late 2026 (exact month TBC)**. After removal, anything still using them breaks. ~6 months out.
- **Independent rotation:** rotating a leaked legacy `service_role` key required rotating the project JWT secret, which logged out *every* signed-in user. The new `sb_secret_…` key rotates on its own in seconds with zero session impact — meaningful for a shared Bill+Duncan tool.
- **Misuse guardrails:** a secret key returns 401 if used from a browser (User-Agent match); you can mint multiple secret keys and revoke them individually.

**Prerequisite already done:** `supabase` pinned to `2.28.3` in both
[generate_svg.py](modal_functions/generate_svg.py) and [keep_alive.py](modal_functions/keep_alive.py)
(2.9.1's regex rejected non-JWT keys). The new secret keys aren't JWTs — they must be
sent on the `apikey` header, not `Authorization: Bearer`; the modern client handles this.

**Scope (low-risk — both key types work simultaneously):**
- In the Supabase dashboard → Settings → API Keys, create a new **secret key** (`sb_secret_…`)
- Update the **value** of the `supabase_for_svg_gen` Modal secret's `SUPABASE_SERVICE_ROLE_KEY` to the new key (env var **name** stays the same — three callers read it: both Modal apps + `scripts/seed.js`)
- `modal deploy modal_functions/generate_svg.py` **and** `modal deploy modal_functions/keep_alive.py` (two separate Modal apps share the secret)
- Test: trigger a generation (Flow A) and run `modal run modal_functions/keep_alive.py`
- Check for any other server-side caller that embeds the key: the schema's `pg_cron` heartbeat job, `pg_net` / Database Webhooks (send the secret on the `apikey` header)
- Once everything is verified on the new key, **delete the legacy `service_role` key** in the dashboard

**Out of scope (separate track):**
- Migrating Supabase **JWT signing keys** to asymmetric (JWKS) so [api/generate.ts](api/generate.ts) can verify user JWTs with a public key locally. Related modernization, NOT required for the API-key swap. Backlog.

**Acceptance**
- Generation flows + keep_alive cron both work on the new `sb_secret_…` key
- Legacy `service_role` key deleted from the Supabase dashboard with nothing broken

---

### 12. Concave collider generation — outer-boundary outline `[ ]`

New initiative driven by the downstream gist repo's concave-collider refactor.
Source of truth for the *why*: [../gist/Notes_on_Concave_Colliders_Refactor.md](../gist/Notes_on_Concave_Colliders_Refactor.md)
(read the Phase 0 + 2026-06-25 "four-option generator" Findings entries).

**Why now.** GIST's physics curriculum needs genuinely concave colliders — open
containers (cup/bucket "catch the marble") and open-top vehicles (wagon, Newton's
1st law). gist **Phase 0 is SHIPPED**: it proved a hand-authored concave outline
decomposes into a dynamic `compound` body that catches and tips, with **zero
engine changes**. The decomposition path (`poly-decomp`'s `makeCCW` + `quickDecomp`)
already exists in gist and is **engine-agnostic** (Rapier *and* Planck parity tested).
So the engine was never the gap — **content + the generator (this repo) are.**

**The decision: decompose DOWNSTREAM; this repo emits the raw concave outline.**
The generator outputs the true concave silhouette as a `type:"convex"` collider
(the accepted-concave misnomer), and gist decomposes it at load — identical to the
Phase 0 hand-authored cup. Chosen over decomposing upstream so `poly-decomp` stays
single-sourced in gist (no second copy here; stored geometry == authored outline).
**We do NOT add `poly-decomp` to this repo.** → **REVISED 2026-07-17 (bird
finding, Task 15):** `poly-decomp@0.3.0` is now a dependency, exact-pinned to
gist's version (frozen upstream since 2018, no install scripts), **verdict-only**
— `planckReadiness` decomposes concave outlines for an exact per-part Planck
check; parts are discarded, never stored/exported. Decomposition *for physics*
stays single-sourced in gist. The original rule's intent (no version drift, no
second physics path) is preserved; only the "never run it here at all" letter
changed, because the runner/bird specimens proved outline-level heuristics
cannot separate safe from harmful concave outlines.

**Keep-in-sync / cross-repo contract (load-bearing):**
- **UPDATE 2026-07-16 — rename greenlit + shipped at the manifest boundary.** gist
  confirmed its loader now reads `type:"polygon"`, so **manifest v2 emits
  `"polygon"`** via `toManifestCollider()` in [App.jsx](src/App.jsx) (incl. inside
  `compound` parts). **Boundary-only by decision (Bill, 2026-07-16):** DB rows,
  `colliderSchema`/`colliderGenerator`, UI, and the LLM contract all still say
  `"convex"` internally — only the export translates. A full internal rename was
  considered and deferred (6+ files + stored-jsonb migration; not worth it while
  only gist consumes the name). The paragraph below records the pre-rename state.
- *(Historical, superseded above)* gist's `ManifestCollider` was `convex | box |
  circle` — no `polygon` type; a `type:"polygon"` entry resolved to `undefined`
  downstream and the body built with **no collider**. That's why this repo emitted
  `type:"convex"` until gist landed its Phase 4 rename. Our `convex`-named outline
  IS the polygon path downstream.
- This is a browser-only generator change. It does **not** touch
  [shared/system_prompt.json](shared/system_prompt.json), so **no `modal deploy`
  is owed** — the LLM still only picks a type intent; the client computes geometry.

**The structural blocker — outer-boundary extraction.** `extractFilledVertices` in
[colliderGenerator.js](src/lib/colliderGenerator.js) returns an *unordered point
cloud* and both entry points `convexHull` it immediately (filling the cup's mouth).
Decomposition downstream needs an **ordered, simple, closed ring** (a single outline
traversal).

**APPROACH — SHIPPED 2026-06-29 (supersedes the 2026-06-25 "vector union" plan).**
Built as a **two-tool auto-fit series** (Bill's framing: try a tool per shape class),
both client-side in [colliderGenerator.js](src/lib/colliderGenerator.js), zero new deps:
- **Single dominant filled path** → `computeConcaveOutline` — native
  `SVGGeometryElement.getTotalLength()` + `getPointAtLength()`, SVG mounted offscreen in
  the live DOM, `getCTM()` → viewBox units. Best for single-path concave shapes (cup).
  Bill tested: no-go for multi-shape (picks only the largest element = the cactus trunk).
- **Multiple filled shapes** → `computeSilhouetteOutline` — render to offscreen canvas
  (4× supersample) → alpha threshold → largest connected component → **Moore-neighbor
  boundary trace** → RDP. Zero dep, structure-agnostic. Bill tested on the cactus:
  "works VERY well."

> **SUPERSEDED:** the original plan was single-path native **+ `polygon-clipping`
> boolean union** for multi-shape, with "bitmap/OpenCV trace rejected (8 MB WASM,
> AA-fuzzy)." *Why we changed our minds:* the raster route is a **~120-line hand-rolled
> Moore-neighbor trace** (NOT OpenCV) — it's dependency-free, captures arms-and-all
> regardless of how the art is built (N shapes, group transforms, rounded corners,
> stroke-only elements), and for axis-aligned art the steps land on real edges. So
> raster won for multi-shape and `polygon-clipping` was never added. (Vector union
> remains a viable alt if we ever need crisper vector edges and accept the dep.)

**Concrete change set in this repo:**
1. **✓ SHIPPED 2026-06-29 (different route than originally specced).**
   [colliderGenerator.js](src/lib/colliderGenerator.js) — instead of
   `extractFilledRings()`+union, added `extractOrderedOutline`/`computeConcaveOutline`
   (single-path native) and `traceSilhouetteRaster`/`computeSilhouetteOutline` (raster).
   Both emit `type:"convex"` with the raw ordered ring, **no hull**; the existing
   point-cloud convex-hull path is untouched (still used for convex blobs).
2. **✓ SHIPPED 2026-06-25** (alongside Collider Lab Phase 2).
   [colliderSchema.js](src/lib/colliderSchema.js) — `validateConvex` now applies the
   `≤ MAX_CONVEX_VERTICES` (8) cap **only to genuinely-convex polygons** (detected via
   `isConvexPolygon` — the shapes Planck consumes directly). A concave outline stored as
   `convex` bypasses the cap and is instead validated as a **simple, non-self-intersecting
   closed ring** via the new exported `isSimplePolygon()` helper (O(n²) proper-crossing
   test). We do NOT pre-guarantee CCW — gist's `makeCCW` normalizes winding; the
   requirement is "ordered simple closed ring." File header comment corrected: the cap
   exists **solely for Planck** (matter.js removed from gist 2026-05-11; Rapier re-hulls,
   no limit). Verified: box4→valid, convex-9→reject (cap), cup-8/cup-12 concave→valid,
   bow-tie→reject (self-intersect).
3. Editor UX — **✓ RESOLVED BY REMOVAL 2026-07-02.** The plan was to flip DetailModal's
   stale amber warning (*"…the engine will use the convex hull"*) to "concave → decomposed
   downstream (allowed)." Instead the entire DetailModal collider section (incl.
   `ColliderEditor`) was removed (Task 13 decision) — so there's no warning left to flip.
   The Collider Lab's own editor already shows the correct "concave → decomposed
   downstream (allowed)" message. [ColliderEditor.jsx](src/components/ColliderEditor.jsx)
   is now orphaned (deletion noted in CLAUDE.md → Known minor issues). Compounds still
   need to become editable in the Lab (`colliderToEditableVertices` returns null for
   `compound` today).

**Four-option generator plan (box / circle / pill / polygon) — verdicts from gist:**
- Emit a **closed polygon, not a "polyline."** An open polyline is a one-sided edge
  chain with no interior volume — invalid on dynamic bodies (the exact failure this
  whole refactor avoids).
- **"Pill" is not a free primitive.** Planck/Box2D has no capsule (only Rapier does),
  and gist's `ShapeDescriptor` is `circle | rectangle | polygon | compound`. Emit a
  pill as a **2-circle + rectangle `compound`** — rides the existing compound path,
  zero adapter change. Collapses four options to three primitives + compound.

**Open questions (UNRESOLVED — UI design is the next conversation):**
- **Outline-selection rule.** When a sprite has several filled shapes (umbrella =
  filled canopy + stroke-only ribs), which is "the outline"? Largest filled path?
  Author-tagged element? Auto-union of all filled shapes? Strokes contribute zero fill
  area, so a fill-union ignores thin ribs — the **Tier-2 umbrella case gist explicitly
  deferred** (fix would be stroke-offsetting, not a rewrite).
- **Type-selection UX.** Does the generator auto-detect polygon-vs-convex, or does the
  four-option choice become an explicit author control (matching the LLM-type-intent
  model)? **← the UI thread Bill wants to open next.**
- **Validation timing.** Add winding/self-intersection rejection here now, or defer to
  gist's Phase-4 build-time validator?

**Scope gate (gist side).** gist's agent-side dev is **paused** pending Bill's
canonical "Tier 1" defined-sim list (cup + open-top wagon confirmed; rest TBC). This
generator work is the "getting ahead" track; the resumed downstream dev is gated on
*lock Tier 1 → implement this change set → gist Phase 4 landing*.

**Acceptance**
- Generator emits an ordered, simple, closed concave outline labeled `type:"convex"`
  for a cup-like SVG (≤8 verts for the first test, matching the Phase 0 recipe)
- A hand-test cup outline round-trips into gist's `manifest.json` and decomposes to a
  3-part compound (verify in gist with `?simdebug=1`)
- Editor no longer tells the user concave is forbidden

---

### 13. Collider Lab — dedicated collider view `[~]`

**Phases 1–2 SHIPPED 2026-06-25** (audit/triage surface + in-place polygon editing +
single-item download). Two Phase-2 sub-items deferred (numeric vertex table, OOB filter);
Phases 3–4 (polygon generation, pill editor) ahead.


Pull all collider review/editing **out of DetailModal** into a separate top-level
**Collider Lab** view: a triage + ground-truth surface where you see "like" SVGs
grouped by collider shape, select one for a large grid-backed view, and confirm/edit
its collider. Consumes the generator work in **Task 12**. Decisions settled 2026-06-25.

**Architecture (low-risk, no schema change, no new deps):**
- **Navigation:** in-app Header view toggle `Grid ⇄ Collider Lab` backed by a `view`
  state in [App.jsx](src/App.jsx). The app has no router — do NOT add one.
- **Data:** new view over existing `useSvgs` items; writes via the existing
  `updatePhysicalProperties` (already targets the parent for children). No schema change.
- **Reuse:** `ColliderPreview` + `ColliderEditor` port in. **Fix the non-square-viewBox
  bug here:** `ColliderEditor` hardcodes a 64×64 canvas, so a rescaled e.g. 35×64 icon
  edits misaligned. The Lab's grid forces honoring real viewBox dims — fixes it properly.

**Grouping (settled):**
- Groups by collider shape: **circle / box / polygon (`convex`) / compound / none**.
  Concave containers are NOT compound here — they're single `convex` rings (gist
  decomposes downstream). Add a **"concave" badge** within the polygon group (detect via
  `isConvexPolygon`) so containers are spottable. The "none" bucket is the triage target.
- **Make grouping EXTENSIBLE:** Bill will define **physics-perspective facets** later
  (richer than shape type). Build the grouping as a pluggable facet, not a hardcoded
  shape switch, so physics facets slot in without a rewrite.

**Ground-truth grid view (the heart):** large render of the unit space (~480px on the
longer viewBox axis), drawing the **viewBox boundary** (correct when non-square), a
**coordinate grid** (lines/labels every 8 units), the SVG content beneath, the collider
overlaid, and a **numerically-editable vertex table** beside the canvas (type `(x,y)`,
not just drag — that's the "ground-truth the coordinates" ask).

**Decisions settled:**
- **DetailModal loses its collider section** → shrinks to read-only thumbnail +
  "Edit in Collider Lab" link. **✓ SHIPPED 2026-07-02.** Generate/edit/save + the
  `ColliderEditor` overlay removed from [DetailModal.jsx](src/components/DetailModal.jsx);
  now a read-only collider overlay + summary + "Edit in Collider Lab ↗" button that
  jumps via `onEditInColliderLab` → App `handleEditInColliderLab` (targets the parent
  for children) → `ColliderLab initialSelectedId`. Rescale-to-fit (which transforms the
  collider) stays in DetailModal. This also retired Task 12 #3's stale concave warning.
- **Children do NOT appear in the Lab** (they inherit; editing writes to the parent).
  Show parents + standalones only.
- **Decomposition = Option A:** edit the raw concave ring, trust gist; do NOT add
  `poly-decomp` here (avoids version-drift with gist's decomposer). Polygons stay
  labeled `type:"convex"` in the manifest **for now** — gist is on dev-hold pending
  Bill's Tier 1 sim list, and Phase 0 tests `convex`-named polygons with zero downstream
  refactor.
- **Polygon generation = single-path native route** (`SVGGeometryElement.getTotalLength()`
  + `getPointAtLength()` on the dominant filled path; zero dependency).

**🔔 Cross-repo reminder (Bill's TODO in gist):** add a **debug switch in gist that
renders the decomposed collider** (how `poly-decomp` actually splits an outline), so we
can ground-truth decomposition downstream *without* importing `poly-decomp` here. This is
the sanctioned substitute for local decomposition preview (Option B, rejected).

**Phasing:**
1. **✓ SHIPPED 2026-06-25.** Lab shell + grouping (extensible facet) + read-only
   ground-truth grid. What landed:
   - [TabStrip.jsx](src/components/TabStrip.jsx) third tab `Collider Lab`;
     [App.jsx](src/App.jsx) `needsLibrary` guard + render branch.
   - [ColliderLab.jsx](src/components/ColliderLab.jsx) — `SHAPE_FACET` grouping (extensible
     `{groups[], bucketOf()}`), triage list, concave badge via `isConvexPolygon`. Excludes
     children + `idea_only`.
   - [ColliderGroundTruth.jsx](src/components/ColliderGroundTruth.jsx) — aspect-correct
     3-layer canvas (icon/grid/collider), reuses `ColliderPreview` + `GeometryInfo`,
     monospace coord readout. Non-square viewBox aligns by construction (sidesteps the
     `ColliderEditor` 64×64-hardcode bug).
   - **Out-of-bounds reveal:** expands the coord space with a gutter when a collider spills
     past 0–W/0–H — extended grid, drawn viewBox boundary, red off-canvas vertex markers,
     amber per-edge overflow warning, `⚠` flags in the readout. Added optional
     `viewBoxMinX/MinY` props to [ColliderPreview.jsx](src/components/ColliderPreview.jsx)
     (default 0,0 — DetailModal unaffected) + `overflow: visible`.
   - **Data-quality finding:** several seeded colliders have vertices below the viewBox
     (confirmed: `dynamics_cart`, `fire_truck`, `flat_asteroid`). Pre-existing defect the
     Lab now surfaces; the fix path is Phase 2 editing.
2. **◐ CORE SHIPPED 2026-06-25.** Editing in the grid — built **directly into
   [ColliderGroundTruth.jsx](src/components/ColliderGroundTruth.jsx)'s expandable
   coordinate space** rather than porting `ColliderEditor` (a better call — sidesteps its
   64×64-hardcode bug entirely, and the fixed-on-entry edit canvas is the only way to reach
   far-off-canvas vertices). What landed: drag/add/remove vertices (`getScreenCTM` in any
   viewBox), **"Pull in-bounds"** (clamp all verts to 0–W/0–H), Save via
   `updatePhysicalProperties` (raw, not `wrapMutation`, so failures report accurately),
   remount-on-`key` reset, convexity-aware validation (convex ≤8 hard gate / concave =
   simple-ring, see Task 12 #2), OOB warning moved **below** the canvas so it never reflows
   the handles, and a **single-item zip download** (`{name}.zip` = SVG + manifest entry via
   shared `buildManifestEntry`; no `markExported`). **Still deferred from this phase:** the
   **numerically-editable vertex table** (type `(x,y)`, not just drag) and the
   **"⚠ N out-of-bounds" filter/sort** so the broken seeded colliders are one click away.
   Editing is **convex-polygon only** so far (circle/box/compound stay read-only).
   **Editor UX redesign 2026-07-02** (prompted by the 33-vert `runner` silhouette being
   unreadable): `PolygonEditLayer` now shows state by **dot color only** (blue idle / white
   hover / red clicked-dragging / red ring = OOB), **no** per-vertex numbers, ×'s, or
   per-edge + ghosts. Hit-testing is geometric (nearest vertex / nearest edge). **Add** =
   click an edge (cursor → `copy` "+" arrow when an edge can accept one); **delete** =
   `Delete`/`Backspace` on the hovered/selected vertex (window listener, ignores text
   fields). The Planck verdict moved **below** the grid so it never shifts the icon/grid
   mid-edit. Still tunable (edge-hit distance) but called good for now.
3. **◐ CORE SHIPPED 2026-06-29.** Polygon generation — TWO auto-fit tools
   (single-path native `computeConcaveOutline` + raster silhouette
   `computeSilhouetteOutline`; see Task 12) wired as ground-truth buttons that drop into
   the Phase-2 edit draft, **plus Planck-readiness warnings** (verdict line + triage
   badges + wrong-tool nudge; see Task 15). **Still ahead:** flip the **DetailModal
   `ColliderEditor`** concave warning ("forbidden" → "decomposed downstream") — Task 12
   #3, still unflipped (the Lab's own editor messaging is already correct).
4. Pill parametric editor (the only "compound" we need near-term — drag two end-circles,
   set radius).

**Acceptance**
- Collider Lab reachable from the Header; groups items by collider shape with a triage
  "none" bucket and a concave badge
- Selecting an item shows the grid view with correct viewBox (incl. non-square),
  coordinate grid, SVG + collider overlay, and an editable vertex table
- Editing writes through `updatePhysicalProperties` (parent for children) — no schema change
- ✓ DetailModal collider section removed in favor of an "Edit in Collider Lab" link (2026-07-02)

---

### 14. Manifest declares its collider coordinate space (Option B) — cross-repo `[✓]` DONE 2026-07-16 (both halves; dynamics_cart round-trip verified)

Cross-repo note from a 2026-06-25 gist session. Source of truth for the *why*:
[../gist/Notes_on_Concave_Colliders_Refactor.md](../gist/Notes_on_Concave_Colliders_Refactor.md)
→ Findings **2026-06-25 "manifest collider viewBox mis-scaling FIXED"** and
**2026-07-16 "manifest-readiness race CLOSED"** (the race entry moved there
from gist's parking lot when it was fixed).

**What just landed in gist (context — Option A, SHIPPED + visually verified).**
gist had a **library-wide** collider bug: its loader
(`scaleManifestColliderToShape`) assumed every collider lived in a **64×64**
viewBox. But our rescaled sprites are **non-square** — **172 of 208** (e.g.
`dynamics_cart` 64×27.43, `frisbee` 64×18.29, `sled` 64×12). For those, gist
squished the collider onto the off-64 axis and mis-centered it, so the object
**sank into surfaces it landed on** (wheels/rim ended up *below* the collider).

This was the **downstream half of the SAME non-square-viewBox problem we fixed
upstream** in `ColliderGroundTruth` (the aspect-correct view that sidesteps the
`ColliderEditor` 64×64-hardcode). Our re-authored colliders looked right **here**
but sank **there**. gist's Option A fix maps **per-axis** from each sprite's true
viewBox (square sprites unchanged; all 172 non-square corrected; cart + frisbee
spot-checked). **Net: colliders authored in this repo's true-viewBox space now map
correctly downstream — the Collider Lab is validated as the spot-check / rebuild
surface (Task 13).**

**Status update (gist session 2026-07-16): the race is CLOSED — independently
of Option B.** gist now gates its sim mount (`adapterReady` in `BaseSimulation`)
on `Promise.all([adapter, loadManifest()])`, so bodies can no longer build
against an unpopulated manifest. Drive-verified by Bill on throttled Slow 4G.
**Consequence for this task:** "dissolves gist's race" is no longer part of
Option B's payoff. What the throttle drive *did* show is that the per-sprite
viewBox fetch pass is the **mount-latency long pole on slow networks** — one
round-trip per approved manifest entry (~0.7 kB each, pure latency, capped by
the browser's per-host connection limit), and gist's sim mount now *waits* for
all of them. Time-to-first-sim on slow connections scales with library size.
So Option B's remaining payoff is: (a) eliminate that N-fetch startup pass,
(b) the self-describing-contract robustness. Still fold into Task 12/13 work;
urgency rises if the library grows much past ~200 sprites.

**What's still open — Option B (the durable contract).** Option A has gist
*infer* the coordinate space by **fetching + parsing every SVG at load** (a
startup fetch pass that gist's mount gate now waits on). Option B makes
the manifest **self-describing**: this repo emits each collider's authoring viewBox
in the export, and gist reads it instead of inferring.

- **This repo's half — ✓ SHIPPED 2026-07-16:** `buildManifestEntry` in
  [App.jsx](src/App.jsx) now emits `view_box: [x, y, w, h]` (parsed from the
  item's own SVG via `parseViewBox`; `null` if unparseable → gist falls back to
  fetch-and-infer for that sprite), and `manifest_version` bumped **1 → 2**.
  Shipped together with the `convex → polygon` boundary rename (Task 12) so v2
  gates both shape changes at once. Covers both consumers automatically (zip
  export + Collider Lab single-item download share the builder).
- **gist's half — ✓ DONE 2026-07-16 (gist-side session, confirmed by Bill):**
  reads `view_box` from the v2 manifest. Verified same day with the export half
  (see acceptance below).
- **Joint decision — ✓ DECIDED 2026-07-16 (gist session):** field is
  **`view_box: [x, y, width, height]`**, a **sibling of `name`/`status`** on the
  entry (NOT inside `physical_properties`). Full 4-tuple matches SVG semantics
  even though our convention pins origin at (0,0). Same "manifest is the
  cross-repo contract" theme as the `convex → polygon` rename (Task 12, also
  greenlit + shipped at the boundary the same day).

**Division of labor (agreed 2026-06-25).** The Collider Lab authors/corrects
colliders and owns the **export half** + the **overshoot cleanup** (below); gist
owns the **loader half** + its own race. Only the field name/shape is joint.

**Adjacent cleanup (this repo, low priority).** The gist audit found **54
colliders that overshoot their sprite viewBox by 1–5 units** (benign silhouette
imprecision — e.g. `drum` +3.7, `hamburger` +5). These are exactly what the
Collider Lab's **out-of-bounds reveal already flags** (Task 13 Phase 1 finding).
Triage in the Lab during Phase 2 editing; not a gist concern.

**Priority: NOT urgent.** Option A already makes gist correct. Option B's payoff is
robustness (if collider-space ever diverges from the SVG viewBox) + dropping gist's
startup fetch + dissolving its race. **Fold into Task 12/13 work** when next
touching export/authoring rather than doing it standalone.

**Acceptance**
- ✓ Manifest export carries each collider's authoring viewBox under the agreed
  field (`view_box: [x,y,w,h]`, entry-level sibling); `manifest_version` bumped
  to 2 (documented in CLAUDE.md → Download approved).
- ✓ gist reads it (loader half landed gist-side 2026-07-16; the race was already
  closed — this bought mount latency, not correctness). Confirm on the gist side
  that the per-SVG viewBox fetch pass is actually removed, not just bypassed —
  that's where the latency win lives.
- ✓ A non-square asset round-trips Lab → manifest → gist: **dynamics_cart**
  (`view_box: [0, 0, 64, 27.4286]`, concave/`polygon` collider) rendered and
  collided correctly — Bill + gist-side session, 2026-07-16.

---

### 15. Planck-readiness warnings (authoring + gist dev build) — cross-repo `[~]`

**Strategy (Bill, 2026-06-29):** GIST keeps a **two-engine adapter** (Planck +
Rapier) with **no default** — deliberately, for the learning and to keep the
adapter seam clean for later 3D / better-2D / cross-domain numerical engines
(chem, bio, earth-space). So **we develop to Planck because it's the strictest
constraint** — anything looser comes for free. This repo's job stays: (a) great
SVGs, (b) manifests with the info GIST needs. New: surface **Planck warnings**
so we can make good adapter decisions — **dev-build only, never production**.

**Confirmed gist behavior (agent code-read 2026-06-29, cited):**
`decomposePolygonShape` (gist `src/physics/shapeHelpers.ts:13-22`) runs
`makeCCW` + `quickDecomp` on **every** `type:"convex"` collider (convex→1 part;
concave→compound). **There is NO per-part ≤8 vertex cap anywhere in gist** — a
documented-but-unimplemented gap. Live example: `dynamics_cart` decomposes to
parts `[3,4,4,5,3,9]` — the **9-vertex part already trips it today**. Adapters:
**Rapier** (`RapierAdapter.ts:119`) `ColliderDesc.convexHull` re-hulls every
part → safe at any count; **Planck** (`PlanckAdapter.ts:77`)
`new planck.Polygon(verts)` directly — **silently accepts >8 (no throw),
undefined Box2D behavior** (a quiet correctness bug, not a crash).

**The poly-decomp boundary decides where each warning can live.** This repo
never runs poly-decomp (single-sourced in gist by design), so it only sees the
raw outline. But `quickDecomp` (Bayazit) adds **no Steiner points** — every
decomposed part's vertices are a subset of the outline's — which makes most of
the verdict exactly knowable at authoring time:

| Collider | Verdict (knowable here) |
|---|---|
| circle / box | ok |
| convex ≤8 | ok |
| convex >8 | **fail** — decomposition can't reduce it |
| concave ≤8 | ok — every part is a subset ⇒ all ≤8 |
| concave >8 | **warn** — a part *might* exceed 8; only gist dev build can confirm |

**This repo's half — SHIPPED 2026-06-29:**
- `planckReadiness(collider)` in [colliderSchema.js](src/lib/colliderSchema.js)
  — the ruleset above, `{ level: "ok"|"warn"|"fail", message }`.
- Collider Lab ground-truth: a colored **Planck verdict line**
  ([ColliderGroundTruth.jsx](src/components/ColliderGroundTruth.jsx),
  `PlanckVerdict`), live during edit (reads the draft).
- Lab triage list: **`⚠P` / `✖P` badges** on cards
  ([ColliderLab.jsx](src/components/ColliderLab.jsx), `planckLevel`).
- **Wrong-tool nudge:** both auto-fit trace buttons toast a redirect when their
  output is convex >8 ("silhouette/path is the wrong tool for a convex blob —
  try circle or ≤8 hull").

**gist's half — TODO (gist owns; resumes when gist dev does):** the
AUTHORITATIVE post-decomposition check — only gist can compute it. In
`decomposePolygonShape`, after `quickDecomp`, for each part with
`length > 8`, `console.warn` **gated to dev builds** (`import.meta.env.DEV` or
gist's equivalent) with `{ renderableName, partIndex, vertexCount }`. Resolves
exactly the **concave >8** case this repo can only flag as `warn`. Belongs to
gist's already-deferred "post-decomp part-vertex check" (its Notes ≈315-320).
Do NOT add it to production builds — it's adapter-decision tooling.

**Manifest: no new field (decided, against stamping).** gist already has the
vertices, so its dev build computes the authoritative check itself — stamping a
heuristic `planck_ready` into the manifest would only duplicate it and risk
staleness. Keep the manifest lean. (Unrelated pending manifest change is Task
14's authoring-viewBox.)

**⚠ Cross-repo correction (gist session 2026-07-02) — the cap is 12, not 8.**
Code-read of gist's pinned Planck: `Settings.maxPolygonVertices = 12` (not the
Box2D-classic 8 this task assumed), and `PolygonShape._set` **silently truncates** to
the first 12 verts then convex-hulls them (no throw) — so the real silent-break is a
decomposed part **>12**, not >8. The `planckReadiness` ruleset here (`convex >8 = fail`,
`concave >8 = warn`) is therefore *conservative*, not exact. **Bill's decision: leave
the heuristic as-is for now and DON'T re-tune the threshold yet** — gist is adding a
**collider observation overlay** (renders the actual decomposed geometry + per-part vert
counts, flags parts >12) as an *observation instrument*; the 8-vs-12 portability target
gets decided once we have data on real objects, here and upstream. Concrete data point:
the updated **`runner`** (34-vert concave outline) decomposes to **12 parts, max 7 verts
— safe** — yet this repo's heuristic flags it `warn` (concave >8). That false-alarm gap
is exactly why the authoritative call lives downstream. Source of truth:
[../gist/Notes_on_Concave_Colliders_Refactor.md](../gist/Notes_on_Concave_Colliders_Refactor.md)
→ Findings 2026-07-02 + "Collider debug / observation mode".

**⚠ Cross-repo data (gist session 2026-07-16) — first confirmed HARMFUL
specimen: `bird`. The 2026-07-02 "decide once we have data" gate is answered.**

`bird` (39-vert concave outline, `view_box` 64×53.2573, approved in the v2
library) decomposes (gist `quickDecomp`) to **10 parts, vert counts
`[3,3,10,4,5,4,4,4,4,16]`** — the torso oval is a **16-vertex part, over the
real Planck cap of 12**. Engine-truth diff (a real `planck.Polygon` built from
that part and compared to the authored geometry): Planck keeps the first 12
verts and re-hulls, dropping the four **underbelly** vertices (viewBox
x 15–38, y 34–41) — the belly arc becomes a flat chord, max deviation
**≈6.5% of sprite height**. **Drive-confirmed by Bill same day** (Planck,
`?colliders=1`): the dynamics cart wedged visibly *inside* the drawn
underbelly outline; correct contact on Rapier. Crucially, gist's observation
overlay draws the *authored* decomposition (engine-actual fixture readback is
deferred), so the wrong fixture is **invisible in every tool both repos
currently have** — only behavior reveals it. Exhibit (screenshot + sim JSON):
`../gist/user_exhibits_for_dev_and_debugging/`. Full analysis:
[../gist/Notes_on_Concave_Colliders_Refactor.md](../gist/Notes_on_Concave_Colliders_Refactor.md)
→ Findings 2026-07-16 (asset finding under the manifest-v2 entry).

**What the two specimens decide.** `runner` (34-vert concave → 12 parts,
max 7 — SAFE) and `bird` (39-vert concave → 16-vert part — HARMFUL) both land
in the heuristic's identical `concave >8 ⇒ warn` bucket. No outline-level
threshold re-tune (8 vs 12) can separate them — the verdict is a property of
the *decomposition*, not the outline. So:

- **Recommendation (this repo): make the concave verdict EXACT at authoring
  time.** Run the same decomposition (`poly-decomp`'s `makeCCW` +
  `quickDecomp`, pinned to gist's version) inside `planckReadiness` /
  the Lab, verdict-only — decomposed parts are NOT exported and the manifest
  contract is unchanged (gist still single-sources decomposition for
  physics; this is the same check, run early, on the same deterministic
  algorithm). Result: `bird` → `✖P` with facts ("part 9: 16 verts > 12"),
  `runner` → `ok` (kills its false alarm). The `convex >8` branch can also
  correct to the true cap (≤12 ok).
- **Asset fix:** re-trace / coarsen `bird`'s torso arc so no decomposed part
  exceeds 12 — first entry in the over-cap triage queue (the Lab's exact
  verdict then becomes the regression check at approval).
- **gist's half (unchanged, still pending there):** the dev-build
  post-decompose warn — now with cap **12** (not this task's original 8) and
  a motivating exhibit. Tracked gist-side as roadmap item CC2.

**Acceptance**
- ✓ Lab shows a Planck verdict per collider and badges risky ones in the list.
- ✓ Tracing a convex >8 shape (asteroid) nudges toward circle/hull.
- ✓ Concave verdicts are exact (authoring-time decomposition) — SHIPPED
  2026-07-17: `planckReadiness` runs pinned `poly-decomp@0.3.0`
  (`makeCCW`+`quickDecomp`, mirroring gist's `decomposePolygonShape`) and
  fails with part facts. Convex cap corrected to 12 (`MAX_CONVEX_VERTICES`),
  which also moves the save-gate, editor add-vertex cap, and hull-tool target
  (Bill's call: 12 everywhere). Lab spot-check CONFIRMED by Bill 2026-07-17:
  over-cap SVGs show `✖P`.
- ☐ `bird` re-traced so all decomposed parts ≤12; verified in the Lab.
- ☐ gist dev build warns on any decomposed part >12 (authoritative check;
  e.g. `bird`'s 16-vert torso part) and is silent in production.
  (gist-side CC2, pending.)

---

### 16. Over-cap triage: fix options + a "Fix" status for Planck-failing SVGs — `[◐]` part 2 shipped 2026-07-18 (16b); part 1 (fix options) open

Planned by Bill 2026-07-17, immediately after the exact Planck verdict (Task 15)
shipped and his Lab check confirmed over-cap SVGs badge `✖P`. Two parts:

**(1) Think through fix options for colliders that fail the >12 test.** The
verdict now *identifies* failures exactly; this decides how to *repair* them.
Candidate approaches to evaluate (per shape, extending the "auto-fit tool
series" framing — likely no single universal answer):
- **Re-trace coarser** — silhouette trace with a larger RDP epsilon so smooth
  arcs land fewer vertices per convex run.
- **Manual vertex deletion** in the Lab editor on the offending arc — the
  verdict recomputes live during edit, so "delete until green" already works.
- **Wrong-tool cases** — near-convex blobs should be circle / ≤12-hull, not
  silhouette (the existing nudge). **SHIPPED 2026-07-18:** `◯ Fit circle` /
  `▭ Fit box` buttons in the ground-truth view (`fitPrimitive` →
  `computeColliderForType`) — fit a Planck-safe primitive to the content,
  staged as a draft for review then Save. The direct fix for round/rectangular
  ✖P items (a primitive is always under the cap → verdict goes green). See
  [CLAUDE.md → Collider Lab Phase 3](CLAUDE.md#collider-lab).
- **Compound/pill authoring** for shapes that inherently decompose badly.
- **Possible new tool:** "auto-coarsen until Planck-safe" — iterate RDP epsilon
  until all decomposed parts ≤12. Evaluate whether it earns its complexity vs.
  manual deletion.

`bird` (16-vert torso part) is the pilot specimen — its re-trace is Task 15's
remaining ☐ and should exercise whichever option wins.

**(2) New status `fix` + bulk move of failing items — SHIPPED 2026-07-18 (Task 16b), pending Bill's enum migration.** Intent: an
SVG whose collider fails Planck must not sit in the export set
looking shippable. **Scope decision (2026-07-18): the bulk-move sweeps ALL ✖P
items regardless of stage (draft/revised/approved), not just approved.** `fix`
is thus a "broken-collider repair queue" label, not only an approved-quarantine
— the `Fix` filter becomes the complete repair worklist. Consequence: because
`fix` overwrites the prior status, the return path is **manual** (set status
back via DetailModal once the Lab verdict is green — a repaired draft returns to
draft, NOT silently to approved), and the bulk confirm shows a **status
breakdown** so sweeping in-progress items is never a surprise. Status is a
**multi-runtime contract** — the full keep-in-sync map:

- **DB (migration owed):** `svg_status` is a Postgres enum
  ([gist-supabase-schema.sql](gist-supabase-schema.sql) line 24, used by BOTH
  `physics_svgs.status` and `svg_versions.status` — one ALTER covers both).
  Migration: `alter type svg_status add value 'fix';` run in the Supabase SQL
  editor (note: `ADD VALUE` must run outside a transaction block) AND recorded
  in the schema file (migration 11e) so the file doesn't drift from the live DB.
- **Browser:** `STATUSES` + `STATUS_CONFIG` in
  [constants.js](src/lib/constants.js) (new chip color), which FilterBar/
  SvgCard/DetailModal render from. Check the filter "solo" behavior and the
  status dropdown pick it up automatically from `STATUSES`.
- **Export scope:** "Download approved" filters `status === "approved"`, so
  `fix` items drop out of exports automatically — that's the point. No
  manifest shape change (`manifest_version` stays 2; entries already carry
  `status` and `fix` never appears in an export since exports are
  approved-only).
- **NOT in the LLM contract:** statuses aren't in
  [shared/system_prompt.json](shared/system_prompt.json) → no `modal deploy`
  owed.
- **Archive trigger:** each approved→fix move archives the old row + bumps
  `version` (status changes always do). Expected, harmless.
- **Workflow design Qs — RESOLVED:** `fix` → prior status is **manual** via the
  DetailModal status control (renders from `STATUSES`, so `fix` appears
  automatically). Auto-promote logic only touches `draft`; a `fix` item won't
  auto-promote — no change needed. Confirmed.
- **Bulk-move mechanics — SHIPPED:** a Lab triage action, since the failing set
  is computed **client-side** (`planckReadiness` needs the decomposition) so
  plain SQL can't find it. [ColliderLab.jsx](src/components/ColliderLab.jsx)
  `handleBulkMoveToFix` — **"Move all ✖P → Fix (N)"** button that targets
  `planckLevel === "fail"` AND `status !== "fix"` (so re-running is a no-op),
  computed from the FULL lab set (not the filtered view, so nothing hidden is
  missed), with a status-breakdown `window.confirm`, looping `updateStatus`
  (passed as `onSetStatus`). Also added: **status filter buttons** in the Lab
  (mirror FilterBar's solo behavior; idea_only excluded).

**Acceptance**
- ☐ Fix options (part 1) written up here with a chosen default per shape class;
  `bird` repaired as the pilot (closes Task 15's ☐). **Still open — part 1.**
- ☑ `fix` exists end-to-end: schema file updated (migration 11e) + `STATUSES`/
  `STATUS_CONFIG` chip (red/rose) + FilterBar button (auto) + Lab status filters.
  **Bill still owes the live enum migration** (`alter type svg_status add value
  'fix';` outside a txn) — code is deployed but the DB write of a `fix` row will
  error until then.
- ☑ Bulk-move sweeps all `✖P` items to `fix`; export scope (`status ===
  "approved"`) verifiably excludes them. **Verify after the migration.**

---

## Completed off-task-list work

### Trash (soft delete) + rename (2026-06-24) `[x]`

QoL: cull and redo objects, and fix slugs, without losing data or names.

What landed:
- **Schema migration 11d** (run by Bill 2026-06-24): `deleted_at`/`deleted_by` columns on `physics_svgs`; the global `unique (name)` constraint replaced with a partial unique index `physics_svgs_name_active_key on (name) where deleted_at is null`; `svgs_with_details` view recreated to expose `deleted_at`/`deleted_by`/`deleted_by_name`. Verified: trash → name freed → new object with the same name inserts → restore prompts for a new name.
- **Filesystem name semantics:** names are unique only among ACTIVE items. Trashing frees the name; trashed rows can share names. Collision checks (create/rename/restore) compare against active names only.
- **[useSvgs.js](src/hooks/useSvgs.js):** `items` excludes trashed; new `trashedItems` list; mutations `renameSvg` (DB-first + `onRenamed` callback), `trashSvg` (cascade via one `.or()` UPDATE), `restoreSvg` (keyed by `_uuid`, optional rename-on-collision), `deleteSvgPermanently` (owner-only cascade hard delete). Shape gained `deletedAt`/`deletedByName`.
- **[DetailModal.jsx](src/components/DetailModal.jsx):** inline rename (slug primary + autofocused, display label auto-follows underscores→spaces until edited) and a Trash button (cascade-count confirm for parents).
- **[TrashPanel.jsx](src/components/TrashPanel.jsx)** (new) + Header `Trash (N)` button: per-row Restore (blank rename field on collision — never auto-suffixed, because the slug is semantic LLM input) and owner-only Delete.
- **RLS:** no new policies — trash/restore are UPDATEs (editor), permanent delete is a DELETE (owner).

See [CLAUDE.md → Trash (soft delete) and rename](CLAUDE.md#trash-soft-delete-and-rename).

**Backlog spun off:** none required. Possible future polish — replace the `window.confirm` trash/delete dialogs with styled modals; surface "(N variants)" cascade scope in the grid not just the modal.

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

## Runbook: onboarding a tester / collaborator

When someone new (e.g. Duncan, or a colleague helping test) signs up via the app
but **sees no icons**, it's RLS: they're a valid `auth.users` row but have no
`project_members` entry, so every data read returns zero rows (no error, just
empty). Add them as a member in the **Supabase SQL editor** (runs as service
role, bypasses the owner-only insert policy):

```sql
-- 1. Find their user ID (or use Authentication → Users in the dashboard)
select id, email from auth.users where email = 'their@email.com';

-- 2. Add the membership row
insert into public.project_members (user_id, display_name, role)
values ('<their-auth-user-id>', 'Their Name', 'editor');
```

- `role`: `editor` (review/annotate/revise, can't manage members), `owner`
  (can add/remove members), or `viewer` (read-only).
- `display_name` shows up in attribution lines ("Exported as v3 · … · Their Name").
- They just **refresh the browser** afterward — no re-login needed.

Other gotchas seen during local-test onboarding:

- **`vercel dev` env vars come from their linked Vercel project, not `.env.local`.**
  Each collaborator uses their own free Vercel account, links a new project, and
  sets the four vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `MODAL_ENDPOINT_URL`, `MODAL_BATCH_ENDPOINT_URL`) via `vercel env add ... development`.
  The Modal URLs point at Bill's `billc2013` workspace (shared backend).
- This is the manual version of Task 4 (Duncan in `project_members`) — replace
  with a self-serve invite flow if onboarding becomes frequent.

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
