# Dev Tasks

Prioritized backlog for migrating the GIST Physics SVG Asset Manager from a single Claude.ai artifact into a deployed full-stack app.

> **Note:** This file (and CLAUDE.md) is gitignored — working notes for Bill and Claude only, not committed to the repo.

See [CLAUDE.md](CLAUDE.md) for working conventions, repo state, and the schema-vs-item-shape mapping. See [overview_April_7.md](overview_April_7.md) for full architectural context.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Snapshot

Done locally:
- ✓ Tasks 1, 2, 3, 6, 7

Remaining:
- Tasks 4, 5, 8, 9, 10

The app works end-to-end on `vercel dev` (login → grid → review → both generate flows → audit log). What's missing is multi-user (Realtime), production deploy, the keep-alive job, Duncan's bootstrap, and the zip export.

**Suggested next-task order from here:**
1. **Task 9** (deploy) — unlocks Duncan signing up via the production URL
2. **Task 4** (insert Duncan into project_members) — 10-second SQL after he signs up
3. **Task 5** (Realtime) — multi-user live sync, biggest UX win once Duncan is in
4. **Task 8** (keep_alive) — prevents Supabase free tier from pausing
5. **Task 10** (zip export + final polish)

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

### 8. Build Modal `keep_alive()` weekly cron `[ ]`

**Scope**
- `modal_functions/keep_alive.py` — pings the `heartbeat` table once a week so the free-tier Supabase project doesn't pause after 7 days idle
- Reuse the existing `supabase_for_svg_gen` Modal secret (env vars `SUPABASE_DATA_URL`, `SUPABASE_SERVICE_ROLE_KEY`) — no new secret needed
- Deploy as a Modal scheduled function (`@app.function(schedule=modal.Period(days=7))` or similar)

**Out of scope**
- Slack/email alerting if the heartbeat fails — backlog
- Multi-region redundancy — overkill for free tier

**Acceptance**
- Function deployed and visible in Modal dashboard with a schedule
- Heartbeat row's `last_ping` updates after manual `modal run` invocation
- Document in CLAUDE.md that the cron exists so future Claude doesn't trip over an unfamiliar function

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

### 10. End-to-end test + zip export of approved SVGs `[ ]`

**Scope**
- Walk through a full session against production: log in, generate a new object, give feedback, revise, approve
- Implement zip export of approved SVGs (small client-side helper, JSZip is fine — `npm install jszip`)
- Wire up the existing "Download approved" Header button (currently a stub that toasts "ships in Phase 4")
- Each SVG in the zip named after `physics_svgs.name` (e.g. `wooden_block.svg`)
- Optionally include a `feedback-log.json` per the original artifact's design

**Out of scope**
- Per-status export, per-color export — backlog
- Server-side zip generation — pointless for ~50 small SVGs

**Acceptance**
- Zip downloads from production
- Contains valid SVG files with the right names
- All approved items present, no unapproved leakage

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
- **Modal-side defense in depth:** add `requires_proxy_auth=True` to `generate_svg_http` and rotate Modal API tokens through Vercel. Currently relies on URL secrecy.
