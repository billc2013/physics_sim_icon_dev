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
- Realtime (Task 4)
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

### 3. Wire Supabase client, ship login UI, seed the database `[ ]`

Connect the decomposed app to the live Supabase project. Replaces the localStorage bridge with real DB queries and ships the auth gate.

**Prerequisites**
- Task 2 complete
- Supabase free-tier project exists with [gist-supabase-schema.sql](gist-supabase-schema.sql) applied (confirmed)
- Bill has the project URL, anon key, and service role key from the Supabase dashboard
- Bill creates `.env.local` himself using the `.env.local.example` I provide

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
- `src/hooks/useSvgs.js` — load `svgs_with_details` view, expose status/color/notes update mutations
- `src/hooks/useFeedback.js` — load `feedback_with_author`, post feedback
- All status/color/notes/feedback writes go through Postgres
- Remove the localStorage bridge from Task 2 entirely
- Delete `gist-svg-manager.jsx` (no longer needed as reference)
- In-memory undo stack still works for UI undo; DB versioning is automatic via the `archive_svg_version` trigger

**Scope — Seed script**
- `scripts/seed.js` — Node script that reads `src/lib/seedData.js` and inserts the 50 SVGs into `physics_svgs`
- Run once locally with `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.js`
- Service role key never written to disk; script is idempotent (skip rows where `name` already exists)
- Script is committed; the env vars to run it are not
- Verify what `created_by` allows for system-seeded rows (NULL vs placeholder) — handle accordingly

**Out of scope**
- Realtime subscriptions (Task 4)
- Inserting Bill + Duncan into `project_members` (Task 4-prerequisite — happens after they sign up)
- GeneratePanel functionality (Phase 3)
- Vercel deploy (Task 10)

**Acceptance**
- Logged-out users see the login page
- After Bill + Duncan sign up and the next task inserts them into `project_members`, they see the seeded grid
- All status/color/notes/feedback edits round-trip through the DB
- Both browsers see the same data on reload (no longer dependent on localStorage)
- `seedData.js` and `localStorage` are gone from the runtime path (seedData.js may still exist for the seed script to import)

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

### 6. Build Modal `generate_svg()` function `[ ]`

**Scope**
- `modal_functions/generate_svg.py` — Python function that:
  - Reads system prompt template from constants
  - Builds final prompt: system prompt + library context + feedback history + color palette constraint + current SVG markup
  - Calls Claude API (`claude-sonnet-4-20250514`) with streaming
  - Logs token usage and computed `cost_usd` to `generation_sessions` (status pending → completed/failed)
  - Returns the generated SVG (or streams it)
- `modal secret create anthropic-secret`, `modal secret create supabase-gist-credentials`
- Deploy to Modal

**Acceptance**
- `modal run` against a test prompt returns a valid 64×64 SVG
- `generation_sessions` row created with token counts and cost

---

### 7. Build Vercel serverless proxy `api/generate.ts` `[ ]`

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

### 8. Build the GeneratePanel UI `[ ]`

**Scope**
- Replace the Task 2 stub in `src/components/GeneratePanel.jsx`
- Inputs: object name, optional color tag, optional feedback, optional current SVG
- POST to `/api/generate` with the user's auth token, render streamed SVG preview
- "Accept" → UPDATE `physics_svgs` (or INSERT for new objects)
- "Revise" → keep streaming/iterating with new feedback

**Acceptance**
- End-to-end flow: prompt → Vercel → Modal → Claude → preview → accept/revise → DB update
- New object name not in library inserts a new row; existing name updates and bumps version (via the `archive_svg_version` trigger)

---

### 9. Build Modal `keep_alive()` weekly cron `[ ]`

**Scope**
- `modal_functions/keep_alive.py` — pings the `heartbeat` table once a week so the free-tier Supabase project doesn't pause after 7 days idle
- Deploy as a Modal scheduled function

**Acceptance**
- Scheduled, observable in Modal dashboard
- Heartbeat row updated weekly

---

## Phase 4 — Deploy & polish

### 10. Push to GitHub and set up Vercel auto-deploy `[ ]`

**Scope**
- Create GitHub repo, add remote, push `main`
- Connect the GitHub repo to Vercel
- Configure Vercel env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `MODAL_ENDPOINT_URL`)
- `vercel.json` if any rewrite/header customization is needed
- Verify push to `main` triggers a deploy

**Acceptance**
- Production URL works end-to-end with auth, realtime, and generation

---

### 11. End-to-end test: generate, review, approve, export zip `[ ]`

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
