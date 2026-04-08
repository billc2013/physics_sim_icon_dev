# Dev Tasks

Prioritized backlog for migrating the GIST Physics SVG Asset Manager from a single Claude.ai artifact into a deployed full-stack app.

See [CLAUDE.md](CLAUDE.md) for working conventions and [overview_April_7.md](overview_April_7.md) for full architectural context.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 1 — Foundation

### 1. Initialize git repository `[ ]`

**Scope**
- `git init` in this directory before any code changes
- `.gitignore` for Node, Vite, .env*, .DS_Store, dist/, coverage/, scripts/seed-output, etc.
- Initial commit capturing the current 4 files (overview, schema, jsx, CLAUDE.md, Dev_Tasks.md)

**Out of scope**
- GitHub remote and Vercel hookup (see Task 9)

**Acceptance**
- Local repo exists, clean working tree, baseline commit recorded

---

### 2. Vite + React scaffold and decompose the monolithic .jsx `[ ]`

Stand up a real Vite project in this directory and break [gist-svg-manager.jsx](gist-svg-manager.jsx) into the component/hook/lib structure described in [CLAUDE.md](CLAUDE.md#file-structure-target). No backend work in this task — Supabase wiring lands in Task 3.

**Scope — Vite scaffold**
- `npm create vite@latest .` (React + JavaScript template, in place)
- `npm install`, verify `npm run dev` boots a blank app
- `npm run build` and `npm run preview` work

**Scope — Decomposition (per [CLAUDE.md](CLAUDE.md#file-structure-target))**
- `src/main.jsx`, `src/App.jsx`
- `src/components/`: `SvgGrid.jsx`, `SvgCard.jsx`, `DetailModal.jsx`, `FilterBar.jsx`, `SystemPrompt.jsx`, `GeneratePanel.jsx` (stub — wired in Phase 3)
- `src/hooks/`: empty placeholder directory (real hooks land in Task 3); or leave the directory uncreated until needed
- `src/lib/`: `constants.js` (status config, color ramps, categories), `seedData.js` (the SVG_DATA constant verbatim from the artifact)
- Inline styles preserved verbatim — no Tailwind, no CSS modules, no rewrites
- Expand cryptic short names (`SC`, `SK`, `vis`, `togFilter`, `fbText`, etc.) to readable identifiers
- Preserve all artifact behaviors: filter solo logic, idea-only modal variant, 30-deep in-memory undo, keyboard nav, search, status workflow, color tagging
- No file in `src/` exceeds ~200 lines (excluding seedData.js)

**Scope — Temporary persistence bridge**
- Replace `window.storage.get/set` (the Claude.ai artifact shim) with `localStorage.getItem/setItem` using the same `gist-svg-v2` storage key
- This is throwaway code; it's deleted in Task 3 when Supabase queries take over
- No new abstraction layer — direct `localStorage` calls are fine since they go away

**Out of scope**
- Supabase client, auth, login UI, seed script (Task 3)
- Realtime (Task 5)
- GeneratePanel functionality beyond a stub (Phase 3)
- Tailwind, TypeScript, ESLint config beyond the Vite default
- Visual redesign

**Acceptance**
- `npm run dev` boots and the app behaves identically to the artifact (verify against the Claude.ai version side-by-side)
- `npm run build` and `npm run preview` succeed
- `gist-svg-manager.jsx` is now redundant — keep it in the repo for reference for one more task, then delete in Task 3
- No file in `src/` over ~200 lines (excluding seedData.js)
- All artifact behaviors preserved

---

### 3. Wire Supabase, ship login UI, seed the database, and build the Modal generate_svg() function `[ ]`

Connect the decomposed app to the live Supabase project, replace the localStorage bridge with real DB queries, ship the auth gate, **and** build the Modal function that calls Claude. The Modal piece is bundled here because it's isolated (Python, separate deploy) and lets us verify the Claude prompt and cost logging in isolation before the Vercel proxy and UI come together in later tasks.

**Prerequisites**
- Task 2 complete
- Supabase free-tier project exists with [gist-supabase-schema.sql](gist-supabase-schema.sql) applied (confirmed)
- Bill has the project URL, anon key, and service role key from the Supabase dashboard
- Bill creates `.env.local` himself using the `.env.local.example` I provide
- Bill has a Modal account and the `modal` CLI installed locally (`pip install modal`, `modal token new`)
- Bill has an Anthropic API key (separate from Bill's Pro account if there's billing isolation to maintain)

**Scope — Supabase client**
- Install `@supabase/supabase-js`
- `.env.local.example` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, plus a clearly-marked comment that the service role key goes in a separate env var only set inline when running the seed script
- `src/lib/supabase.js` — singleton client constructed from `import.meta.env.VITE_SUPABASE_*`
- `src/hooks/useSupabase.js` — context provider exposing the client (or skip if a plain import is sufficient — decide during implementation)

**Scope — Auth + login UI**
- `src/hooks/useAuth.js` — session state, signIn, signUp, signOut, `onAuthStateChange` listener
- Minimal login page component (email/password) gating the rest of the app
- Logged-out users see the login page; logged-in users see the grid

**Scope — Replace localStorage with Supabase queries**
- `src/hooks/useSvgs.js` — load `svgs_with_details` view + `svg_feedback` rows in parallel, transform into the artifact's item shape so the existing components don't need rewrites. Exposes status/color/notes/feedback mutations against Postgres.
- All status/color/notes/feedback writes go through Postgres (optimistic local update + rollback on error)
- Remove the localStorage bridge from Task 2 entirely
- Delete `gist-svg-manager.jsx` (no longer needed as reference)
- **Drop the in-memory undo stack.** With Supabase as source of truth, an undo would have to write the previous row back to the DB, which has weird semantics across users (you'd accidentally undo the other person's edits). DB-side history is still captured automatically via the `archive_svg_version` trigger; we'll surface it as a "restore previous version" UI in a later task once we know what UX makes sense.

**Scope — Bootstrap (manual SQL via Supabase SQL editor)**
- After Bill ships the local code and signs up via the new login UI, he grabs his `auth.users.id` from the Supabase auth dashboard
- Bill runs a one-line `INSERT INTO project_members ...` snippet in the Supabase SQL editor (snippet provided by Claude in the run instructions)
- This bootstrap step has to happen *before* the seed script runs, otherwise RLS blocks Bill from seeing anything

**Scope — Seed script**
- `scripts/seed.js` — Node script that reads `src/lib/seedData.js` and inserts the 50 SVGs into `physics_svgs`
- Run once locally with `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.js`
- Service role key never written to disk; script is idempotent (skip rows where `name` already exists)
- Script is committed; the env vars to run it are not
- Verify what `created_by` allows for system-seeded rows (NULL vs placeholder) — handle accordingly

**Scope — Modal `generate_svg()` function**
- `modal_functions/generate_svg.py` — Python function that:
  - Uses the system prompt template from [src/lib/constants.js](src/lib/constants.js) (port the `buildSystemPrompt` text into Python verbatim — single source of truth lives in JS for now, Python mirrors it)
  - Builds final prompt: system prompt + library context + feedback history + color palette constraint + current SVG markup
  - Calls Claude API (`claude-sonnet-4-20250514`) with streaming
  - Logs token usage and computed `cost_usd` to `generation_sessions` (status `pending` → `completed`/`failed`)
  - Returns the generated SVG (or streams it — exact return shape decided during implementation based on Modal's SSE story)
- Modal secrets:
  - `modal secret create anthropic-secret ANTHROPIC_API_KEY=sk-ant-...`
  - `modal secret create supabase-gist-credentials SUPABASE_GIST_URL=... SUPABASE_GIST_SERVICE_ROLE_KEY=...`
- Deployed to Modal via `modal deploy modal_functions/generate_svg.py`
- Verifiable in isolation (no Vercel, no React UI yet) — call directly with `modal run` or via the Modal endpoint URL using curl

**Out of scope**
- Vercel `api/generate.ts` proxy (Task 6)
- GeneratePanel React UI (Task 7)
- Realtime subscriptions (Task 5)
- Inserting Bill + Duncan into `project_members` (Task 4 — happens after they sign up)
- `keep_alive` Modal cron (Task 8)
- Vercel deploy (Task 9)

**Acceptance**
- Logged-out users see the login page
- After Bill + Duncan sign up and Task 4 inserts them into `project_members`, they see the seeded grid
- All status/color/notes/feedback edits round-trip through the DB
- Both browsers see the same data on reload (no longer dependent on localStorage)
- `localStorage` is gone from the runtime path
- `modal run modal_functions/generate_svg.py` (or equivalent test invocation) returns a valid 64×64 SVG for a test prompt
- A `generation_sessions` row is created with non-null `input_tokens`, `output_tokens`, and `cost_usd`

---

### 4. Insert Bill and Duncan into `project_members` `[ ]`

Tiny one-shot bridge task. Runs only after Task 3 ships and both users have signed up via the new login UI.

**Scope**
- After both signups complete, run a SQL snippet (Supabase SQL editor) inserting both `auth.users.id` values into `project_members` with `role = 'owner'` and a `display_name`
- Verify they can read `physics_svgs` from the app

**Acceptance**
- Two owner rows in `project_members`
- Both users see the seeded grid in their browsers

---

## Phase 2 — Realtime sync

### 5. Add Realtime subscriptions to `useSvgs` and `useFeedback` `[ ]`

Deferred from Task 3 to keep that PR scoped to plain reads/writes. Once we know basic queries work, add Realtime.

**Scope**
- Subscribe to `postgres_changes` on `physics_svgs` and `svg_feedback` in the respective hooks
- Reconcile incoming events with local state
- Handle subscription cleanup on unmount and on auth changes
- Verify two browser windows logged in as different users see live updates

**Acceptance**
- Two-window test: status change, color change, feedback post, notes edit all propagate without refresh
- Subscriptions don't leak across logout/login

---

## Phase 3 — Generation pipeline

### 6. Build Vercel serverless proxy `api/generate.ts` `[x]`

**Scope**
- TypeScript Node function in `api/generate.ts`
- Validates Supabase JWT from `Authorization: Bearer ...` header
- Forwards request body to `MODAL_ENDPOINT_URL`, streams SSE response back to client
- No business logic, no DB writes, no Anthropic key

**Acceptance**
- Unauthenticated requests get 401
- Authenticated requests reach Modal and stream back SVG output
- Locally testable with `vercel dev`

---

### 7. Build the GeneratePanel UI — two flows `[x]`

The artifact has two distinct generation entry points and we should preserve that split:

- **Flow A — Generate new object** (Header "Generate more" button): standalone panel with a name field + optional color tag. Submitting calls `/api/generate` with no `svg_id` and no `current_svg`. Accept → INSERT into `physics_svgs`.
- **Flow B — Revise existing object** (DetailModal "Send to Claude" button): uses the open modal item's name, feedback history, color tag, and current SVG markup as context. Submitting calls `/api/generate` with the existing `svg_id`. Accept → UPDATE the row, which auto-archives the prior version via the `archive_svg_version` trigger.

The Modal function I wrote in Task 3 already accepts both shapes — `svg_id` is optional, `current_svg` is optional. The UI is responsible for picking which flow it's in and doing the right INSERT/UPDATE on accept.

**Scope**
- Replace the Task 2 stub in `src/components/GeneratePanel.jsx` with a real component (Flow A)
- Wire the existing DetailModal "Send to Claude" button to a parallel revision UI (Flow B) — likely an inline preview within the modal rather than a separate panel
- Both flows POST to `/api/generate` with the Supabase auth token in the `Authorization` header
- Preview the streamed SVG response inline (large, rendered)
- Both flows include "Accept" and "Revise again" actions
- **Name collision handling for Flow A:** validate the entered name against the in-memory library on input change. If it collides, disable submit and offer "Revise existing instead?" as a one-click jump to Flow B for that item. (We hit this manually with the football — the unique constraint on `physics_svgs.name` will reject the INSERT, so we want to catch it before the round trip.)
- On accept (Flow A INSERT), set `created_by = auth.uid()` and `updated_by = auth.uid()`
- On accept (Flow B UPDATE), set `updated_by = auth.uid()` so the version-archive trigger attributes the prior version to the right user
- After accept, refresh `useSvgs` so the grid reflects the new/updated item

**Out of scope**
- Diff viewer between `svg_versions` entries (backlog item)
- Multi-turn chat-style refinement (Revise just sends a fresh request with accumulated feedback, same as the artifact)

**Acceptance**
- Flow A: typing a fresh name + clicking Generate produces a preview, Accept inserts a new row, the grid updates without reload
- Flow A name collision: typing an existing name disables Generate and shows a "revise instead" affordance
- Flow B: opening a modal item, clicking Send to Claude produces a preview, Accept updates the row, the version is bumped, `svg_versions` gains a snapshot
- Both flows: a corresponding `generation_sessions` row exists with non-null tokens and cost

---

### 8. Build Modal `keep_alive()` weekly cron `[ ]`

**Scope**
- `modal_functions/keep_alive.py` — pings the `heartbeat` table once a week so the free-tier Supabase project doesn't pause after 7 days idle
- Deploy as a Modal scheduled function

**Acceptance**
- Scheduled, observable in Modal dashboard
- Heartbeat row updated weekly

---

## Phase 4 — Deploy & polish

### 9. Push to GitHub and set up Vercel auto-deploy `[ ]`

**Scope**
- Create GitHub repo, add remote, push `main`
- Connect the GitHub repo to Vercel
- Configure Vercel env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `MODAL_ENDPOINT_URL`)
- `vercel.json` if any rewrite/header customization is needed
- Verify push to `main` triggers a deploy

**Acceptance**
- Production URL works end-to-end with auth, realtime, and generation

---

### 10. End-to-end test: generate, review, approve, export zip `[ ]`

**Scope**
- Walk through a full session: log in, generate a new object, give feedback, revise, approve
- Export approved SVGs as a zip (small client-side helper, JSZip is fine)

**Acceptance**
- Zip downloads, contains valid SVG files named after `physics_svgs.name`
- All approved items present

---

## Backlog / nice-to-have (not yet scheduled)

- Tailwind migration (if/when inline styles become painful)
- Keyboard shortcut overlay (`?` to view bindings)
- Bulk approve / bulk re-tag color
- Per-user "favorites" or "needs my review" filter
- Diff viewer between `svg_versions` entries
- Export to Planck.js-compatible JSON manifest
- ESLint + Prettier config
- A small test setup (Vitest) once the surface is stable
