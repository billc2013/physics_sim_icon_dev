---
name: document
description: Capture or revise a design decision in the right doc (CLAUDE.md, overview_April_7.md, Dev_Tasks.md, or the memory dir) and surface this project's two framing models — the keep-in-sync rule and doc-taxonomy lifecycle. Use during or at the end of a coding session: when a design choice is made, changed, shipped, or superseded; when the user asks to "document this", "log this decision", "record why", "update the docs", "note the open question"; or when you notice an undocumented or half-landed decision while working.
---

# document

The GIST Physics SVG Asset Manager's **design-decision capture** skill — the
*during- and end-of-session* counterpart to `/get-up-to-speed` (which orients
you at the *start*). Where get-up-to-speed reads the docs, this skill
**writes** them: it records durable rationale into this project's existing
documentation system and keeps the two framing models at the front of
everyone's mind while a decision is being made.

This project already has a disciplined doc culture (`CLAUDE.md` for "how",
`overview_April_7.md` for "why", `Dev_Tasks.md` for the backlog, plus the
harness memory dir). This skill **drives those existing conventions** — it
does not invent a parallel log.

---

## Front-of-mind: the two framing models (state these when invoked)

Whenever this skill runs, **explicitly restate these two models to the user**
and check the current decision against them. They are the load-bearing habits
of this project; surfacing them is half the point of the skill.

> ⚠️ **These models are LIVING.** Their particulars will keep developing as the
> project grows. State the *current* particulars below, but treat them as a
> frame to extend, not a fixed checklist. If the user refines one, update this
> section.

### 1. The keep-in-sync rule

**A contract that's read by more than one runtime is not "landed" until every
copy agrees — and, for the Modal side, until it's redeployed.** This codebase
runs in three places that can't see each other's source: the **browser**
(React/JS), the **Vercel proxy** (TS), and **Modal** (Python). A value that
lives in two of them is two copies of one decision; changing one without the
others is a silent drift bug. The current instances (all enumerated in
`CLAUDE.md`):

1. **The system prompt** — `shared/system_prompt.json` is the single source,
   but the browser picks up edits on reload while **Modal only sees them after
   `modal deploy modal_functions/generate_svg.py`** (the image bakes the JSON
   in). Edit the JSON → verify in the SystemPrompt overlay → `modal deploy` →
   test a generation.
2. **Model tiers — three places that must agree:** `MODEL_TIERS` in
   `modal_functions/generate_svg.py`, `ALLOWED_MODEL_TIERS` in
   `api/generate.ts`, and `tiers` in `src/components/ModelTierToggle.jsx`.
3. **The schema** — `gist-supabase-schema.sql` is the source of truth, but the
   **live DB only changes when you run the migration** in the Supabase SQL
   editor. The file must not drift from the live DB. Schema changes ripple to
   the `useSvgs` item-shape mapping and often the LLM prompt.
4. **Constants ↔ Python prompt builder** — `buildSystemPrompt` in
   `constants.js` and `build_system_prompt` in `generate_svg.py` render the
   same JSON; if you change the JSON *shape*, update both renderers in lockstep.
5. **The stale predicate** — `isStale()` in `useSvgs.js` is the single source
   used by `SvgCard`, `DetailModal`, and `DownloadApprovedModal`. All three
   MUST use the helper, or they disagree about what's in the next export.

If a decision touches one of these and you've updated only some copies, it
**isn't fully landed** — say so plainly and name which copy is missing (and
whether a `modal deploy` or a SQL migration is still owed). The browser and
Modal drift apart silently; this rule is what keeps them in sync.

### 2. Doc-taxonomy lifecycle

**Decisions move forward through the doc stages; the holding pen doesn't
accumulate stale entries.** The current flow:

```
Dev_Tasks.md backlog ──▶ in progress ──▶ SHIPPED
  (prioritized,            (working on        │   reflect in:
   "what each task          it now)           ├─▶ CLAUDE.md "Current state" + the
   involves")                                 │     relevant how-to section
                                              └─▶ overview_April_7.md (only for
                                                    architecture-level "why" shifts)

CLAUDE.md "Known minor issues / deferred cleanup"
  = the holding pen (parking lot). Entries LEAVE it when fixed (delete) or when
    they earn a real task (promote into Dev_Tasks.md).
```

The disciplines that keep this honest:
- **The "Known minor issues / deferred cleanup" section is a holding pen, not a
  permanent index.** When an entry is fixed, delete it; when it grows into real
  work, move it into `Dev_Tasks.md` and delete the stale copy.
- **`CLAUDE.md`'s "Current state (as of last session)" must reflect reality.**
  When a task ships, flip its ✗ to ✓ there and update the prose that describes
  it. A stale "Current state" is the most misleading thing in the repo.
- **Never silently delete rationale.** When a decision replaces an earlier one,
  mark the old one superseded and link forward/back — *why we changed our minds*
  is the valuable part.
- **Keep `CLAUDE.md`, `overview_April_7.md`, and `Dev_Tasks.md` in sync** with
  reality and each other. `CLAUDE.md` itself asks for this.

When you record something, ask out loud: *does this entry belong where it is
now, or has it earned a move to the next stage (and a deletion from the old
one)?*

> Invariants you don't quietly cross: `CLAUDE.md`'s **"Architectural ground
> rules"** (browser never sees the Anthropic key; Vercel functions are thin
> proxies; all secrets live in Modal; RLS enforced; `requested_by` injected
> from the validated JWT; schema source of truth). If a decision would violate
> one, `CLAUDE.md` says raise it explicitly — don't just document the violation.

---

## Where records live (doc taxonomy)

Pick the home that matches the decision's genre. Prefer extending an existing
doc over creating a new one.

| Genre | File | Use when… |
|---|---|---|
| **How to work / current state** | `CLAUDE.md` | A decision changes how the repo works, a ground rule, the schema↔item mapping, a generation flow, or a "keep in sync" discipline. Update the matching section AND "Current state". |
| **Backlog / roadmap** | `Dev_Tasks.md` | A forward task: what's next, what each remaining task involves, priority. The thing-to-do record. |
| **Architecture / why** | `overview_April_7.md` | A rationale- or architecture-level shift (the diagram, schema rationale, palette ramps). The "why we built it this way" record. Touch this only for real architectural change. |
| **Holding pen** | `CLAUDE.md` → "Known minor issues / deferred cleanup" | An issue surfaced mid-work with no task home yet and not blocking. Note it so it isn't lost; promote it to `Dev_Tasks.md` when it earns a plan. |
| **Agent-facing quick facts** | the memory dir (`~/.claude/projects/.../memory/`) | A durable, non-obvious fact the assistant should reload next session. Private, terse. Cross-links to the human docs; doesn't duplicate them. |

## Conventions to match

- **Match `CLAUDE.md`'s existing section style.** It uses tables for mappings,
  numbered ground rules, per-flow subsections, and a "Current state" checklist
  with ✓/✗. Extend those structures rather than bolting on new formats.
- **Code pointers** use markdown links to `path/to/file.jsx:line` so a reader
  can jump straight to where a value lives (the repo's VSCode convention).
- **Keep the three "keep in sync" triples explicit.** When you document a new
  multi-runtime contract, list every place it lives (and any required
  `modal deploy` / SQL migration), the way `CLAUDE.md` already does for model
  tiers and the system prompt.
- **`Dev_Tasks.md` is prioritized** — place a new task by priority and note
  what it involves, matching the existing entries.

## What to do when invoked

1. **Restate the two framing models** (above) and check this decision against
   them — out loud, to the user. This is the surfacing mechanism; don't skip it.
2. **Identify the decision concretely.** What was chosen/changed, and *why*?
   Restate vague pointers precisely before recording.
3. **Verify facts against the code first.** A doc entry asserts current state —
   confirm values against `src/hooks/useSvgs.js`, `src/lib/constants.js`,
   `modal_functions/generate_svg.py`, `api/generate.ts`, or
   `gist-supabase-schema.sql` rather than trusting memory or a possibly-stale
   doc. Stale numbers in a "decision" are worse than none.
4. **Apply the keep-in-sync rule.** If this touches a multi-runtime contract
   (system prompt, model tiers, schema, the stale predicate), confirm every
   copy is updated — or flag exactly which copy, `modal deploy`, or SQL
   migration is still owed.
5. **Apply lifecycle discipline.** Put the entry in the right-stage doc; if it
   has outgrown its current home (holding pen → real task; task → shipped),
   move it forward and delete the stale copy (mark superseded, link, never
   silently drop rationale).
6. **Pick the home doc** from the taxonomy and write the record in the matching
   convention; update `CLAUDE.md`'s "Current state" checklist if a thing moved.
7. **Cross-link, don't duplicate.** Agent-facing facts → the memory dir (see
   `/get-up-to-speed`). This skill owns the *shareable, human-facing rationale
   in the project docs*; they cross-link, they don't copy.

## How this relates to the other skills / memory

- **`/get-up-to-speed`** — start-of-session orientation; reads what changed and
  loads the memory dir. This skill is its write-side complement.
- **the memory dir** (`~/.claude/projects/.../memory/`) — agent-facing,
  private, quick facts the assistant reloads. The project docs (`CLAUDE.md`,
  `overview_April_7.md`, `Dev_Tasks.md`) are **human-facing and shareable**.
  They cross-link; they don't copy. When they conflict, the code is ground
  truth, then the docs.
