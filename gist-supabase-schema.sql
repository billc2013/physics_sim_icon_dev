-- ============================================================================
-- GIST Physics SVG Asset Manager — Supabase Schema
-- ============================================================================
-- Run these scripts in order in the Supabase SQL Editor.
-- Project: gist-physics-svgs (separate Supabase project)
-- Users: Bill, Duncan (+ future collaborators)
-- ============================================================================


-- ============================================================================
-- 0. EXTENSIONS
-- ============================================================================

create extension if not exists "uuid-ossp";                        -- uuid_generate_v4()
create extension if not exists "pg_cron";                          -- for keep-alive job
create extension if not exists moddatetime schema extensions;      -- auto-update updated_at
create extension if not exists pg_trgm schema extensions;          -- trigram ops for fuzzy search


-- ============================================================================
-- 1. CUSTOM TYPES
-- ============================================================================

create type svg_status as enum (
  'draft',
  'revised',
  'approved',
  'idea_only'
);

create type generation_role as enum (
  'system',
  'user',
  'assistant'
);


-- ============================================================================
-- 2. CORE TABLES
-- ============================================================================

-- -------------------------
-- 2a. Project members
-- -------------------------
-- Maps Supabase auth users to display names and roles within this project.
-- This avoids hard-coding user IDs in policies and lets you add collaborators.

create table public.project_members (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role        text not null default 'editor'
                check (role in ('owner', 'editor', 'viewer')),
  created_at  timestamptz not null default now(),
  
  constraint unique_user unique (user_id)
);

comment on table public.project_members is
  'Maps authenticated users to project roles. Bill and Duncan are owners.';


-- -------------------------
-- 2b. SVG categories
-- -------------------------
-- Lightweight lookup table for organizing objects.

create table public.svg_categories (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null unique,
  description text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.svg_categories is
  'Groupings like vehicles, projectiles, blocks, lab equipment, etc.';

-- Seed the categories from the original list
insert into public.svg_categories (name, description, sort_order) values
  ('vehicles',        'Cars, trucks, trains, rockets, etc.',           1),
  ('projectiles',     'Balls, arrows, cannonballs, etc.',              2),
  ('blocks',          'Wooden blocks, cubes, crates, barrels, etc.',   3),
  ('people',          'Person, runner, skier, etc.',                   4),
  ('connectors',      'Springs, pulleys, ropes, chains',              5),
  ('inclined_planes', 'Ramps, wedges, hills',                         6),
  ('pendulums',       'Pendulum bobs, wrecking balls, rotation',      7),
  ('everyday',        'Tables, chairs, books, carts',                 8),
  ('lab_equipment',   'Dynamics carts, force sensors, masses',        9),
  ('space',           'Satellites, planets, moons, asteroids',       10),
  ('air_resistance',  'Parachutes, balloons, feathers',              11);


-- -------------------------
-- 2c. Color palettes
-- -------------------------
-- Stores the 3-tone color ramps available for SVG recoloring.

create table public.color_palettes (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null unique,
  light_hex   text not null check (light_hex ~ '^#[0-9A-Fa-f]{6}$'),
  mid_hex     text not null check (mid_hex   ~ '^#[0-9A-Fa-f]{6}$'),
  dark_hex    text not null check (dark_hex  ~ '^#[0-9A-Fa-f]{6}$'),
  created_at  timestamptz not null default now()
);

comment on table public.color_palettes is
  'Monochromatic 3-tone ramps for SVG recoloring.';

insert into public.color_palettes (name, light_hex, mid_hex, dark_hex) values
  ('blue',   '#BFDBFE', '#3B82F6', '#1E3A8A'),
  ('red',    '#FECACA', '#EF4444', '#991B1B'),
  ('green',  '#BBF7D0', '#22C55E', '#166534'),
  ('amber',  '#FDE68A', '#F59E0B', '#92400E'),
  ('purple', '#DDD6FE', '#8B5CF6', '#5B21B6'),
  ('teal',   '#99F6E4', '#14B8A6', '#115E59'),
  ('gray',   '#E5E7EB', '#6B7280', '#1F2937'),
  ('pink',   '#FBCFE8', '#EC4899', '#9D174D');


-- -------------------------
-- 2d. Physics SVGs (main table)
-- -------------------------

create table public.physics_svgs (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null unique,
  display_name  text not null,
  svg_content   text not null,
  status        svg_status not null default 'draft',
  category_id   uuid references public.svg_categories(id) on delete set null,
  color_id      uuid references public.color_palettes(id) on delete set null,
  notes         text not null default '',
  version       int not null default 1,
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.physics_svgs is
  'Core table: each row is one physics object SVG with review state.';

-- Auto-update updated_at on any row change
create trigger handle_updated_at
  before update on public.physics_svgs
  for each row
  execute procedure moddatetime(updated_at);


-- -------------------------
-- 2e. SVG version history
-- -------------------------
-- Every time an SVG is revised, the previous version is archived here.
-- This gives you full undo history beyond the in-memory undo stack.

create table public.svg_versions (
  id            uuid primary key default uuid_generate_v4(),
  svg_id        uuid not null references public.physics_svgs(id) on delete cascade,
  version       int not null,
  svg_content   text not null,
  status        svg_status not null,
  notes         text not null default '',
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  
  constraint unique_svg_version unique (svg_id, version)
);

comment on table public.svg_versions is
  'Immutable archive of every SVG revision. Enables full history + rollback.';


-- -------------------------
-- 2f. Feedback
-- -------------------------

create table public.svg_feedback (
  id          uuid primary key default uuid_generate_v4(),
  svg_id      uuid not null references public.physics_svgs(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) > 0),
  created_at  timestamptz not null default now()
);

comment on table public.svg_feedback is
  'Timestamped feedback entries per SVG. Separated from SVGs for clean querying.';


-- -------------------------
-- 2g. Generation sessions
-- -------------------------
-- Tracks each LLM call for SVG generation/revision: prompt, response, cost.

create table public.generation_sessions (
  id              uuid primary key default uuid_generate_v4(),
  svg_id          uuid references public.physics_svgs(id) on delete set null,
  requested_by    uuid not null references auth.users(id) on delete cascade,
  model           text not null default 'claude-sonnet-4-20250514',
  system_prompt   text not null,
  user_prompt     text not null,
  response_svg    text,
  input_tokens    int,
  output_tokens   int,
  cost_usd        numeric(10, 6),
  status          text not null default 'pending'
                    check (status in ('pending', 'completed', 'failed')),
  error_message   text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

comment on table public.generation_sessions is
  'Audit log of every LLM generation/revision call. Tracks cost and tokens.';


-- ============================================================================
-- 3. INDICES
-- ============================================================================

-- Fast filtering by status (the primary workflow query)
create index idx_svgs_status on public.physics_svgs(status);

-- Category lookups
create index idx_svgs_category on public.physics_svgs(category_id);

-- Feedback by SVG (for modal display)
create index idx_feedback_svg on public.svg_feedback(svg_id);

-- Feedback by author (for "what did Duncan say?" queries)
create index idx_feedback_author on public.svg_feedback(author_id);

-- Version history lookups
create index idx_versions_svg on public.svg_versions(svg_id, version desc);

-- Generation sessions by SVG
create index idx_gen_sessions_svg on public.generation_sessions(svg_id);

-- Generation sessions by user (for cost tracking)
create index idx_gen_sessions_user on public.generation_sessions(requested_by);

-- Full-text search on SVG names
create index idx_svgs_name_trgm on public.physics_svgs
  using gin (display_name gin_trgm_ops);


-- ============================================================================
-- 4. HELPER FUNCTIONS
-- ============================================================================

-- -------------------------
-- 4a. Is the current user a project member?
-- -------------------------

create or replace function public.is_project_member()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members
    where user_id = auth.uid()
  );
$$;

-- -------------------------
-- 4b. Get current user's project role
-- -------------------------

create or replace function public.get_project_role()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select role from public.project_members
  where user_id = auth.uid()
  limit 1;
$$;

-- -------------------------
-- 4c. Archive current version before update
-- -------------------------
-- Called by a trigger on physics_svgs. Snapshots the OLD row into svg_versions
-- whenever svg_content or status changes.

create or replace function public.archive_svg_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only archive if content or status actually changed
  if OLD.svg_content is distinct from NEW.svg_content
     or OLD.status is distinct from NEW.status then
    insert into public.svg_versions (svg_id, version, svg_content, status, notes, created_by)
    values (OLD.id, OLD.version, OLD.svg_content, OLD.status, OLD.notes, OLD.updated_by);
    
    -- Bump the version number on the new row
    NEW.version := OLD.version + 1;
  end if;
  
  return NEW;
end;
$$;

create trigger trg_archive_svg_version
  before update on public.physics_svgs
  for each row
  execute function public.archive_svg_version();


-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables
alter table public.project_members      enable row level security;
alter table public.svg_categories       enable row level security;
alter table public.color_palettes       enable row level security;
alter table public.physics_svgs         enable row level security;
alter table public.svg_versions         enable row level security;
alter table public.svg_feedback         enable row level security;
alter table public.generation_sessions  enable row level security;


-- -------------------------
-- 5a. project_members
-- -------------------------
-- Members can see all members. Only owners can add/remove.

create policy "Members can view all members"
  on public.project_members for select
  using (public.is_project_member());

create policy "Owners can insert members"
  on public.project_members for insert
  with check (public.get_project_role() = 'owner');

create policy "Owners can delete members"
  on public.project_members for delete
  using (public.get_project_role() = 'owner');


-- -------------------------
-- 5b. svg_categories (read-only for members, owners can modify)
-- -------------------------

create policy "Members can view categories"
  on public.svg_categories for select
  using (public.is_project_member());

create policy "Owners can manage categories"
  on public.svg_categories for all
  using (public.get_project_role() = 'owner');


-- -------------------------
-- 5c. color_palettes (read-only for all members)
-- -------------------------

create policy "Members can view palettes"
  on public.color_palettes for select
  using (public.is_project_member());

create policy "Owners can manage palettes"
  on public.color_palettes for all
  using (public.get_project_role() = 'owner');


-- -------------------------
-- 5d. physics_svgs
-- -------------------------
-- All members can read. Editors and owners can insert/update.
-- Only owners can delete (safety net).

create policy "Members can view SVGs"
  on public.physics_svgs for select
  using (public.is_project_member());

create policy "Editors can insert SVGs"
  on public.physics_svgs for insert
  with check (
    public.get_project_role() in ('owner', 'editor')
  );

create policy "Editors can update SVGs"
  on public.physics_svgs for update
  using (
    public.get_project_role() in ('owner', 'editor')
  );

create policy "Owners can delete SVGs"
  on public.physics_svgs for delete
  using (public.get_project_role() = 'owner');


-- -------------------------
-- 5e. svg_versions (read-only, written by trigger)
-- -------------------------

create policy "Members can view version history"
  on public.svg_versions for select
  using (public.is_project_member());

-- No insert policy needed: the archive trigger runs as SECURITY DEFINER
-- (bypasses RLS), and the service_role_key also bypasses RLS.


-- -------------------------
-- 5f. svg_feedback
-- -------------------------

create policy "Members can view feedback"
  on public.svg_feedback for select
  using (public.is_project_member());

create policy "Members can add feedback"
  on public.svg_feedback for insert
  with check (
    public.get_project_role() in ('owner', 'editor')
    and author_id = auth.uid()  -- can only post as yourself
  );

-- Users can delete their own feedback, owners can delete anyone's
create policy "Delete own feedback or owner deletes any"
  on public.svg_feedback for delete
  using (
    author_id = auth.uid()
    or public.get_project_role() = 'owner'
  );


-- -------------------------
-- 5g. generation_sessions
-- -------------------------

create policy "Members can view generation sessions"
  on public.generation_sessions for select
  using (public.is_project_member());

create policy "Editors can create generation sessions"
  on public.generation_sessions for insert
  with check (
    public.get_project_role() in ('owner', 'editor')
    and requested_by = auth.uid()
  );

-- No update policy needed: Modal functions use the service_role_key
-- which bypasses RLS entirely.


-- ============================================================================
-- 6. VIEWS (convenience queries for the frontend)
-- ============================================================================

-- -------------------------
-- 6a. SVGs with category name and color info joined
-- -------------------------

create or replace view public.svgs_with_details
with (security_invoker = true) as
select
  s.id,
  s.name,
  s.display_name,
  s.svg_content,
  s.status,
  s.notes,
  s.version,
  s.created_at,
  s.updated_at,
  c.name       as category_name,
  cp.name      as color_name,
  cp.light_hex as color_light,
  cp.mid_hex   as color_mid,
  cp.dark_hex  as color_dark,
  pm_created.display_name as created_by_name,
  pm_updated.display_name as updated_by_name,
  (
    select count(*)::int from public.svg_feedback f
    where f.svg_id = s.id
  ) as feedback_count
from public.physics_svgs s
left join public.svg_categories c   on s.category_id = c.id
left join public.color_palettes cp  on s.color_id = cp.id
left join public.project_members pm_created on s.created_by = pm_created.user_id
left join public.project_members pm_updated on s.updated_by = pm_updated.user_id;


-- -------------------------
-- 6b. Feedback with author display name
-- -------------------------

create or replace view public.feedback_with_author
with (security_invoker = true) as
select
  f.id,
  f.svg_id,
  f.body,
  f.created_at,
  pm.display_name as author_name
from public.svg_feedback f
join public.project_members pm on f.author_id = pm.user_id;


-- -------------------------
-- 6c. Status summary (for dashboard counts)
-- -------------------------

create or replace view public.svg_status_summary
with (security_invoker = true) as
select
  status,
  count(*)::int as count
from public.physics_svgs
group by status;


-- ============================================================================
-- 7. REALTIME
-- ============================================================================
-- Enable realtime for tables where Bill and Duncan need live updates.

alter publication supabase_realtime add table public.physics_svgs;
alter publication supabase_realtime add table public.svg_feedback;


-- ============================================================================
-- 8. KEEP-ALIVE CRON JOB
-- ============================================================================
-- Pings a row in a heartbeat table once per week to keep the project active
-- on Supabase free tier. Same pattern as your Lily Bot keep-alive.

create table if not exists public.heartbeat (
  id          int primary key default 1 check (id = 1),  -- singleton row
  last_ping   timestamptz not null default now()
);

-- Seed the singleton row
insert into public.heartbeat (id, last_ping) values (1, now())
on conflict (id) do nothing;

-- The cron job: runs every Sunday at 6am UTC
-- (pg_cron must be enabled in your Supabase project settings)
select cron.schedule(
  'weekly-keep-alive',
  '0 6 * * 0',  -- every Sunday at 06:00 UTC
  $$
    update public.heartbeat
    set last_ping = now()
    where id = 1;
  $$
);

-- No RLS on heartbeat — it's an internal system table
alter table public.heartbeat enable row level security;

create policy "Anyone can read heartbeat"
  on public.heartbeat for select
  using (true);


-- ============================================================================
-- 9. SEED BILL AND DUNCAN AS OWNERS
-- ============================================================================
-- Run this AFTER both users have signed up via Supabase Auth.
-- Replace the UUIDs with actual auth.users.id values.
--
-- insert into public.project_members (user_id, display_name, role) values
--   ('BILLS_AUTH_UUID_HERE',   'Bill',   'owner'),
--   ('DUNCANS_AUTH_UUID_HERE', 'Duncan', 'owner');


-- ============================================================================
-- 10. NOTES FOR DEPLOYMENT
-- ============================================================================
--
-- CIRCULAR CONSTRAINTS:
--   None in this schema. All foreign keys point "downward":
--   physics_svgs -> svg_categories, color_palettes, auth.users
--   svg_feedback -> physics_svgs, auth.users
--   svg_versions -> physics_svgs, auth.users
--   generation_sessions -> physics_svgs, auth.users
--   No table references another that references it back.
--
-- MIGRATION ORDER:
--   1. Extensions (section 0)
--   2. Types (section 1)
--   3. Tables in order: project_members, svg_categories, color_palettes,
--      physics_svgs, svg_versions, svg_feedback, generation_sessions
--   4. Indices (section 3)
--   5. Functions + triggers (section 4)
--   6. RLS policies (section 5)
--   7. Views (section 6)
--   8. Realtime (section 7)
--   9. Keep-alive (section 8)
--  10. Seed users (section 9) — after auth signup
--
-- MODAL INTEGRATION:
--   Your Modal functions should use the SUPABASE_SERVICE_ROLE_KEY to bypass
--   RLS when inserting generation_sessions or updating SVGs from LLM output.
--   The service role key goes into modal.Secret, same as Lily Bot.
--
-- VERCEL FRONTEND:
--   Use the SUPABASE_ANON_KEY (public) in the browser client. RLS policies
--   ensure users only see/edit what their role permits. The anon key is safe
--   to expose in client-side code because RLS enforces access control.
