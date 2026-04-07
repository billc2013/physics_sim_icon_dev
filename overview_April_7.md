# GIST Physics SVG Asset Manager

## Project overview

A collaborative tool for managing SVG icons used in physics force-and-motion simulations for the GIST project (LLM → JSON → Planck.js educational physics pipeline). Bill and Duncan review, annotate, and iteratively revise SVGs with Claude, then export approved assets for use in the simulation engine.

This started as a Claude.ai artifact and is being migrated to a standalone full-stack app.

## Team

- **Bill** — educational consultant / STEM educator, project lead. BS Physics, MS Mechanical Engineering. Comfortable with code as a practical tool, not a professional developer. Uses Mac (Apple Silicon).
- **Duncan** — collaborator at Tufts CEEO, co-developer on the GIST project.

## Architecture

```
Browser (Vite + React)
  ├── SVG grid view (filter, search, review)
  ├── Detail modal (feedback, status, color palette)
  └── Generation UI (prompt, generate, revise)
        │
        ▼
Vercel (hosting + serverless API routes)
  ├── Static assets (Vite build output)
  └── api/generate.ts (auth-validating proxy to Modal)
        │
        ▼
Modal.com (serverless functions + secrets)
  ├── generate_svg() — calls Claude API, logs usage
  └── keep_alive() — weekly Supabase heartbeat (free tier)
        │
        ▼
Anthropic Claude API (claude-sonnet-4-20250514)
        │
        ▼
Supabase (dedicated free-tier project, separate org)
  ├── Postgres (schema, RLS, triggers, pg_cron)
  ├── Auth (email/password for Bill + Duncan)
  ├── Realtime (live sync between users)
  └── Tables: physics_svgs, svg_feedback, svg_versions,
      generation_sessions, project_members, svg_categories,
      color_palettes, heartbeat
```

### Key architectural decisions

- **Vercel serverless function is a thin proxy.** It validates the auth token and forwards to Modal. No business logic lives in Vercel.
- **Modal holds all API keys** via `modal.Secret`. The browser never sees the Anthropic key.
- **Supabase is on a free-tier project** in a separate org from Bill's Pro subscription. This means the Postgres instance can pause after 7 days of inactivity, so an external keep-alive (Modal cron) is required. The `pg_cron` heartbeat job is a backup for when the DB is awake.
- **Service role key bypasses RLS.** Modal functions use `SUPABASE_SERVICE_ROLE_KEY` to write generation sessions and update SVGs. The browser client uses the anon key, and RLS enforces access control.
- **Realtime** is enabled on `physics_svgs` and `svg_feedback` so both users see live updates without polling.

## Tech stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Vite + React (.jsx) | Single-page app, no SSR needed |
| Styling | Tailwind or inline styles | Match the existing component style |
| Hosting | Vercel | Auto-deploys from GitHub on push |
| API proxy | Vercel serverless functions | `api/` directory, Node.js runtime |
| Compute | Modal.com | Python serverless functions |
| LLM | Anthropic Claude API | claude-sonnet-4-20250514 |
| Database | Supabase Postgres | Free tier, separate org |
| Auth | Supabase Auth | Email/password, JWT-based |
| Realtime | Supabase Realtime | Websocket subscriptions |
| Repo | GitHub | Source of truth |

## Database schema

Schema is defined in `supabase/schema.sql`. Key tables:

### physics_svgs (main table)
- `id` uuid PK
- `name` text unique (snake_case identifier like `wooden_block`)
- `display_name` text (human-readable: "wooden block")
- `svg_content` text (full SVG markup)
- `status` enum: `draft`, `revised`, `approved`, `idea_only`
- `category_id` FK → svg_categories
- `color_id` FK → color_palettes
- `notes` text (for idea_only items: how it fits the physics engine)
- `version` int (auto-incremented by trigger)
- `created_by`, `updated_by` FK → auth.users

### svg_feedback
- `id` uuid PK
- `svg_id` FK → physics_svgs (cascade delete)
- `author_id` FK → auth.users (cascade delete)
- `body` text (non-empty constraint)
- `created_at` timestamptz

### svg_versions
- `id` uuid PK
- `svg_id` FK → physics_svgs (cascade delete)
- `version` int
- `svg_content`, `status`, `notes`, `created_by`
- Unique constraint on (svg_id, version)
- Populated automatically by `archive_svg_version()` trigger

### generation_sessions
- `id` uuid PK
- `svg_id` FK → physics_svgs
- `requested_by` FK → auth.users
- `model` text, `system_prompt` text, `user_prompt` text
- `response_svg` text, `input_tokens`, `output_tokens`, `cost_usd`
- `status`: pending, completed, failed

### project_members
- `user_id` FK → auth.users (unique)
- `display_name` text
- `role`: owner, editor, viewer

### Supporting tables
- `svg_categories` — groupings (vehicles, projectiles, blocks, etc.)
- `color_palettes` — 3-tone ramps (light/mid/dark hex values)
- `heartbeat` — singleton row for keep-alive ping

### Views (all with security_invoker = true)
- `svgs_with_details` — SVGs joined with category, color, author names, feedback count
- `feedback_with_author` — feedback joined with author display name
- `svg_status_summary` — count per status for dashboard

### Triggers
- `archive_svg_version()` — before UPDATE on physics_svgs, snapshots old row to svg_versions when content or status changes, bumps version number
- `moddatetime(updated_at)` — auto-updates updated_at timestamp

### RLS model
- All tables have RLS enabled
- `is_project_member()` and `get_project_role()` are SECURITY DEFINER helper functions with pinned `search_path = ''`
- Viewers: read-only on all tables
- Editors: read + insert/update on SVGs and feedback
- Owners: full access including delete and member management
- Feedback enforces `author_id = auth.uid()` (post as yourself only)
- Service role key bypasses RLS (used by Modal functions)

### Security notes
- All SECURITY DEFINER functions have `set search_path = ''`
- All views use `security_invoker = true`
- Extensions (moddatetime, pg_trgm) installed in `extensions` schema, not `public`
- No `with check (true)` policies — triggers and service role bypass RLS natively
- The only `using (true)` SELECT policy is on the heartbeat table (intentional)

## SVG specifications

All physics object SVGs follow these rules:
- **ViewBox:** 64×64
- **Style:** simple filled shapes, clean silhouettes, no external dependencies
- **Colors:** Tailwind-inspired palette, monochromatic 3-tone (light/mid/dark from same hue)
- **People:** abstract non-skin colors (blue, purple, green, orange) for inclusivity
- **Rendering:** must look good at both 64px (grid thumbnail) and 200px (modal preview)
- **Format:** inline SVG markup stored as text in the database

### Color palette ramps (8 available)

| Name | Light | Mid | Dark |
|------|-------|-----|------|
| blue | #BFDBFE | #3B82F6 | #1E3A8A |
| red | #FECACA | #EF4444 | #991B1B |
| green | #BBF7D0 | #22C55E | #166534 |
| amber | #FDE68A | #F59E0B | #92400E |
| purple | #DDD6FE | #8B5CF6 | #5B21B6 |
| teal | #99F6E4 | #14B8A6 | #115E59 |
| gray | #E5E7EB | #6B7280 | #1F2937 |
| pink | #FBCFE8 | #EC4899 | #9D174D |

### SVG status workflow
- **draft** — initial state, needs review
- **revised** — has received feedback, may have updated SVG content
- **approved** — ready for export and use in Planck.js simulations
- **idea_only** — concept is valid but implementation is via the physics engine, not a standalone SVG (e.g., rope → distance joints, ramp → angle control, spring → spring joints)

### Object categories
vehicles, projectiles, blocks, people, connectors, inclined_planes, pendulums, everyday, lab_equipment, space, air_resistance

## SVG generation system prompt

Used when generating or revising SVGs via Claude:

```
You generate SVG icons for the GIST project (LLM → JSON → Planck.js). Rules:
- 64x64 viewBox, simple silhouettes, Tailwind-inspired fills
- No external deps, inline styles only
- Monochromatic 3-tone (light/mid/dark from same hue)
- People: abstract non-skin colors for inclusivity
- Categories: vehicles, projectiles, blocks, people, connectors,
  planes, pendulums, everyday, lab, space, air resistance

Library ({count}): {comma-separated list of existing object names}
```

When revising, append: feedback history, color palette constraint (if tagged), and the current SVG markup.

## File structure (target)

```
gist-physics-svgs/
├── CLAUDE.md                  # This file
├── package.json
├── vite.config.js
├── vercel.json
├── .env.local                 # Local dev env vars (gitignored)
├── .gitignore
├── public/
├── src/
│   ├── main.jsx               # App entry point
│   ├── App.jsx                # Root component
│   ├── components/
│   │   ├── SvgGrid.jsx        # Grid view with filter/search
│   │   ├── SvgCard.jsx        # Individual card in grid
│   │   ├── DetailModal.jsx    # Review modal with feedback/status/color
│   │   ├── GeneratePanel.jsx  # Generation UI
│   │   ├── SystemPrompt.jsx   # System prompt viewer
│   │   └── FilterBar.jsx      # Status filter buttons
│   ├── hooks/
│   │   ├── useSupabase.js     # Supabase client singleton
│   │   ├── useSvgs.js         # SVG CRUD + realtime subscription
│   │   ├── useFeedback.js     # Feedback operations
│   │   └── useAuth.js         # Auth state management
│   ├── lib/
│   │   ├── supabase.js        # createClient with env vars
│   │   └── constants.js       # Status config, color ramps, categories
│   └── styles/                # If using CSS files
├── api/
│   └── generate.ts            # Vercel serverless: proxy to Modal
├── supabase/
│   ├── schema.sql             # Full database schema
│   └── security-fixes.sql     # Security advisor fixes
├── modal_functions/
│   ├── generate_svg.py        # SVG generation via Claude API
│   └── keep_alive.py          # Weekly Supabase heartbeat
└── assets/
    └── svgs/                  # 50 initial SVG files (reference copies)
```

## Environment variables

### Vercel (.env.local for dev, Vercel dashboard for prod)
```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
MODAL_ENDPOINT_URL=https://xxxxx.modal.run
```

### Modal secrets
```
modal secret create supabase-gist-credentials \
  SUPABASE_GIST_URL=https://xxxxx.supabase.co \
  SUPABASE_GIST_SERVICE_ROLE_KEY=eyJ...

modal secret create anthropic-secret \
  ANTHROPIC_API_KEY=sk-ant-...
```

## Development workflow

### Local dev
```bash
npm install
npm run dev          # Vite dev server on localhost:5173
```

### Deploy
```bash
git push origin main  # Auto-deploys to Vercel
modal deploy modal_functions/generate_svg.py  # Deploy Modal functions
```

### Database changes
- Edit `supabase/schema.sql` for schema changes
- Run migration SQL in Supabase SQL Editor
- Keep schema.sql as the source of truth for clean re-deployment

## Key patterns

### Undo system
The React app maintains an in-memory undo stack (30 deep) for UI operations. The database provides permanent version history via the `svg_versions` table and `archive_svg_version()` trigger.

### Filter behavior
Clicking a status filter when all are shown **solos** that status. Clicking it again restores all four. This is more intuitive than separate all/none buttons.

### Idea-only notes vs feedback
When an SVG is in `idea_only` status, the modal shows a "Notes" textarea (how this concept maps to the physics engine) instead of the feedback form. All other statuses show the feedback form for revision notes.

### Realtime sync
Subscribe to Supabase Realtime channels on `physics_svgs` and `svg_feedback`. When one user makes changes, the other sees updates without refreshing.

### Generation flow
1. Client POSTs to `/api/generate` with auth token, feedback, color tag, current SVG
2. Vercel function validates auth, creates a `generation_sessions` row (pending)
3. Vercel calls Modal `generate_svg.remote()` with SSE streaming
4. Modal builds prompt (system prompt + library context + feedback + palette)
5. Modal streams Claude's response back through Vercel to the browser
6. Modal logs token usage and cost to `generation_sessions`
7. User previews, accepts (UPDATE physics_svgs) or adds more feedback

## What's built so far

- [x] 50 initial SVG assets (64×64, physics objects)
- [x] React component with grid view, detail modal, status workflow, feedback, color tags, undo, keyboard nav, search, filter
- [x] Supabase schema (7 tables, triggers, RLS, views, indices, realtime)
- [x] Security hardening (search_path, security_invoker, no always-true policies)
- [x] System architecture diagram
- [x] pg_cron keep-alive (backup, not primary for free tier)

## What's next

- [ ] Initialize Vite project and decompose monolithic .jsx into component files
- [ ] Set up Supabase client and auth (login page)
- [ ] Seed Bill and Duncan as owners (after auth signup)
- [ ] Migrate from in-memory state to Supabase queries + realtime
- [ ] Build Vercel serverless proxy (`api/generate.ts`)
- [ ] Build Modal `generate_svg()` function
- [ ] Build Modal `keep_alive()` function
- [ ] Set up GitHub repo and Vercel auto-deploy
- [ ] Seed the 50 initial SVGs into the database
- [ ] End-to-end test: generate, review, approve, export zip