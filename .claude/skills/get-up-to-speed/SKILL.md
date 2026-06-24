---
name: get-up-to-speed
description: Get up to speed on the GIST Physics SVG Asset Manager — onboard, orient, catch up on what changed, review the project state before working. Use when starting a fresh session here, or when asked to "get up to speed", "catch me up", "onboard", "review the project", or "what's the state of this".
---

# get-up-to-speed

Onboarding skill for the **GIST Physics SVG Asset Manager** — a full-stack
Vite + React app where Bill and Duncan review, annotate, and iteratively
revise the SVG icons that feed the GIST physics-simulation pipeline
(LLM → JSON → Planck.js/Rapier). Browser → Vercel proxy → Modal → Claude →
Supabase.

Unlike the companion `gist` repo, **this project has rich, hand-maintained
docs** — they are the source of truth and you read them first:

- **[CLAUDE.md](../../../CLAUDE.md)** — the "how to work in this repo": current
  state, architectural ground rules, the schema↔item mapping, the four
  generation flows, every "keep in sync" discipline. ~39 KB; load-bearing.
- **[overview_April_7.md](../../../overview_April_7.md)** — the "why":
  architecture diagram, schema rationale, color palette ramps.
- **[Dev_Tasks.md](../../../Dev_Tasks.md)** — the prioritized backlog and what
  each remaining task involves.

So why a skill at all? Because the **code drifts faster than the prose**. The
docs tell you the *intended* state; this skill tells you which source files
**actually changed** since you last onboarded — and therefore which doc
sections may now be stale. It is **incremental**: the first run reads broadly
and records durable facts to the memory dir; every run after that only points
you at the files that changed, so getting up to speed stays cheap as the
project grows.

**The driver** is `.claude/skills/get-up-to-speed/digest.py` — a stdlib-only
scanner that hashes the tree, diffs it against a saved snapshot, and prints
exactly what to read. All paths below are relative to the project root.

## Run (agent path)

From the project root, scan (read-only — writes nothing):

```bash
python3 .claude/skills/get-up-to-speed/digest.py
```

This prints four sections:
1. **header** — file count + when you last onboarded (`never` = first run).
2. **project map** — tracked `.jsx`/`.js`/`.ts`/`.py`/`.md`/`.sql`/`.json`
   counts per top-level area.
3. **changed since last digest** — `+ NEW` / `~ MODIFIED` / `- REMOVED`
   (or, on a first run, a "what to read" starter list).
4. **context pointers** — `CLAUDE.md`, the two design docs, and whether the
   memory dir and `MEMORY.md` exist.

Then:
- **First run** (or after a long gap): read `CLAUDE.md`, `overview_April_7.md`,
  and `Dev_Tasks.md`, then the load-bearing code — `src/App.jsx` (orchestration),
  `src/hooks/useSvgs.js` (the schema↔item mapping + mutations),
  `src/lib/constants.js` (`buildSystemPrompt`, model/status constants),
  `shared/system_prompt.json` (the shared LLM contract),
  `modal_functions/generate_svg.py` (Claude calls), `api/generate.ts` (the
  Vercel proxy), and `gist-supabase-schema.sql` (the DB contract). Load the
  memory index (below).
- **Later runs**: read only the `MODIFIED`/`NEW` files. That's the point.

After you've absorbed it, **record what's durable and non-obvious** to the
memory dir shown in the context pointers (one fact per file + a line in
`MEMORY.md`). If the code has drifted from the docs, update `CLAUDE.md` /
`Dev_Tasks.md` to match — that's the write-side, and `/document` is its
dedicated skill. Then mark this state as digested:

```bash
python3 .claude/skills/get-up-to-speed/digest.py --commit
```

`--commit` saves the snapshot to
`.claude/skills/get-up-to-speed/state/manifest.json`, so the next run's delta
is measured from here. Commit only after you've captured learnings — the scan
is repeatable and idempotent until you do.

## The memory dir (where distilled knowledge lives)

The harness keys it off the absolute project path. For this project:

```
~/.claude/projects/-Users-williamchurch-Documents-CRCS-Tufts-GIST-Sim-Work-physics-sim-icon-dev/memory/
```

`MEMORY.md` there is the index (one line per fact). Read it first; combined
with `CLAUDE.md` it's the fastest orientation in the whole project. Add to it
as you learn; that is the "improve over time" half of this skill.

## Companion skill

`/get-up-to-speed` is the *start-of-session* read side. Its *during- and
end-of-session* write-side complement is **`/document`** — it captures durable
design rationale into this project's docs and surfaces the two framing models
that keep this codebase honest (the **keep-in-sync rule** and **doc-taxonomy
lifecycle**). When a session makes or changes a real design decision, reach
for `/document`.

## Project map (orientation)

- `src/App.jsx` — auth gate + `SignedInApp` orchestration. Holds one
  `useGeneration` (Flow A, blocking) and one `useGenerationQueue` (Flows B/C/D,
  fire-and-forget). The `handleConfirmDownload` zip-export entrypoint lives here.
- `src/hooks/` — `useAuth` (session), `useSvgs` (loads the `svgs_with_details`
  view + feedback, exposes mutations, **transforms schema rows into the
  artifact item shape** — load-bearing), `useGeneration` / `useGenerationQueue`
  (generation state machines), `useBatchGeneration`.
- `src/lib/` — `constants.js` (`buildSystemPrompt`, statuses, model tiers,
  `COLOR_RAMPS` — keep in sync with the Python side), `colliderSchema.js` /
  `colliderGenerator.js` (collider types + programmatic SVG→collider),
  `svgGeometry.js`, `supabase.js` (singleton client), `transforms/` (the CSV
  data-cleaning pipeline).
- `src/components/` — the modals (`DetailModal`, `GenerateNewModal`,
  `BatchGenerateModal`, `DownloadApprovedModal`, `ImportSvgModal`,
  `QueuePanel`), the grid/cards, the collider editor/preview, `data/` (the
  data-transform page).
- `shared/system_prompt.json` — the **single source of truth** for the Claude
  generation prompt + the category list. Read by BOTH `constants.js` (browser)
  and `generate_svg.py` (Modal). Editing it requires
  `modal deploy modal_functions/generate_svg.py` for the Python side to see it.
- `api/` — Vercel serverless **thin auth proxies** (`generate.ts`,
  `batch-generate.ts`). Validate the Supabase JWT, inject `requested_by`,
  forward to Modal. No business logic.
- `modal_functions/` — Python Modal backend. `generate_svg.py` holds both the
  single-object and batch functions (Claude calls, audit logging, secrets);
  `keep_alive.py` is a weekly cron pinging Supabase to dodge the free-tier pause.
- `gist-supabase-schema.sql` — the full Postgres schema (the DB contract).
- root `*.md` — `CLAUDE.md` (how), `overview_April_7.md` (why), `Dev_Tasks.md`
  (backlog). `gist-svg-manager.jsx` is the original Claude.ai artifact, kept as
  reference, not in the build.

## Gotchas

- **The docs are the source of truth, but they can be stale.** When code and
  prose disagree, the code is ground truth — then reconcile the docs (that's
  `/document`). A current example: `CLAUDE.md`'s header note claims it and
  `Dev_Tasks.md` are *gitignored*; they are in fact **git-tracked**. Verify
  before trusting a doc's meta-claims.
- **`.claude/` IS git-tracked in this repo** (unlike `gist`). So this skill and
  its `state/manifest.json` snapshot are committable. If you don't want the
  per-machine snapshot in git, the `state/` dir can be gitignored — the
  `SKILL.md` + `digest.py` are the shareable part.
- **Memory-dir slug replaces `/`, `_`, AND `.` with `-`.** Not just slashes.
  A naive `path.replace("/", "-")` builds an orphan dir the harness never
  reads. `digest.py`'s `memory_dir()` already handles this — don't "simplify" it.
- **The skill ignores the whole skills tree.** `.claude/skills/` is excluded
  from the manifest, so editing any skill (or rewriting the snapshot) never
  shows up as a project "change." (`.claude/settings.json` outside `skills/` is
  still tracked.)
- **Change detection is content-hash based (SHA-1), not mtime.** A `git
  checkout` or file copy that bumps mtime without changing bytes won't produce
  false deltas; a real edit always will.
- **Generated/vendored trees are skipped:** `node_modules`, `dist`, `.venv`,
  `.vercel`, `__pycache__`, etc. The thousands of `.py` files under `.venv` are
  NOT project code — only `modal_functions/` is. Lockfiles
  (`package-lock.json`, `pnpm-lock.yaml`) and `settings.local.json` are skipped
  by name to keep the signal clean.
- **The system prompt and the schema are contracts that span runtimes.** When
  `shared/system_prompt.json` changes, the Modal side only sees it after
  `modal deploy`; when `gist-supabase-schema.sql` changes, the live DB only
  changes after you run the migration in the Supabase SQL editor. A changed
  contract file is a flag to check its other copies (see `/document`'s
  keep-in-sync rule).

## Troubleshooting

- **"memory dir ... [MISSING]"** → create it by writing the first memory file
  (the Write tool makes parent dirs). For this project it already exists.
- **Everything shows as `+ NEW` every run** → you never ran `--commit`, so
  there's no snapshot to diff against. Commit once to establish a baseline.
- **`python3: command not found`** → use the interpreter that's present
  (`python`), or the project's `.venv` if activated.
