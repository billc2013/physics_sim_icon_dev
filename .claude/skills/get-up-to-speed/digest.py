#!/usr/bin/env python3
"""
get-up-to-speed digest: scan this project, diff it against the last
onboarding snapshot, and tell a future agent EXACTLY what to read.

Why this exists: this repo DOES have rich hand-maintained docs (CLAUDE.md,
overview_April_7.md, Dev_Tasks.md) — read those first, they're the state of
the project. But the *code* drifts faster than that prose. This script is
the memory of "what I'd already digested," so every run after the first
points you only at the source files that *changed* since you last got up to
speed — and, transitively, at the doc sections that may now be stale.

Usage (run from the project root):
    python3 .claude/skills/get-up-to-speed/digest.py            # scan + report (read-only)
    python3 .claude/skills/get-up-to-speed/digest.py --commit   # report, then save snapshot

Flow: scan (read-only) -> read the changed files -> update CLAUDE.md /
Dev_Tasks.md / the memory dir as needed -> --commit to mark this state as
"digested".

Stdlib only. No deps. Runs on Bill's macOS box and in CI alike.
"""

import argparse
import hashlib
import json
import os
import time
from pathlib import Path

# --- what counts as project content worth tracking -------------------------
# This is a Vite + React app (src/, .jsx/.js), a thin Vercel proxy layer
# (api/, .ts), a Python Modal backend (modal_functions/, .py), a shared
# contract (shared/system_prompt.json), the Postgres schema
# (gist-supabase-schema.sql), and a pile of root design/working notes (.md).
# Track the source the project actually authors; skip generated/vendored.
TRACK_EXT = {".jsx", ".js", ".ts", ".py", ".md", ".sql", ".json"}
SKIP_DIRS = {
    ".git", "node_modules", "__pycache__",
    ".venv", "venv", ".mypy_cache",
    "dist", "dist-ssr", "build", "coverage", ".next", ".vscode",
    ".vercel", ".vite",
}
# Lockfiles churn constantly and aren't "code you read"; settings.local.json
# is machine-local. Keep the signal clean by skipping them by name.
SKIP_NAMES = {
    ".DS_Store",
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
    "settings.local.json",
}
# The skill tracks the project, not itself. Exclude the whole skills tree so
# editing any skill (or rewriting this skill's manifest) never shows up as a
# project "change."
SELF_DIR = Path(".claude/skills")

SCRIPT_DIR = Path(__file__).resolve().parent
MANIFEST = SCRIPT_DIR / "state" / "manifest.json"

# Memory lives outside the repo, keyed by the project's absolute path.
# Claude Code's slug replaces "/", "_", and "." with "-" (verified against
# the harness-provided memory path), so we must match that exactly or our
# writes land in a dir the harness never reads.
def memory_dir(root: Path) -> Path:
    slug = str(root).translate(str.maketrans({"/": "-", "_": "-", ".": "-"}))
    return Path.home() / ".claude" / "projects" / slug / "memory"


def sha1(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def scan(root: Path) -> dict:
    """Return {relpath: {sha1, size, mtime}} for tracked files."""
    out = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name in SKIP_NAMES:
                continue
            p = Path(dirpath) / name
            rel = p.relative_to(root)
            if SELF_DIR in rel.parents:
                continue
            if p.suffix.lower() not in TRACK_EXT:
                continue
            try:
                st = p.stat()
                out[str(rel)] = {
                    "sha1": sha1(p),
                    "size": st.st_size,
                    "mtime": int(st.st_mtime),
                }
            except OSError:
                continue
    return out


def load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {}


def diff(prev_files: dict, cur_files: dict):
    prev, cur = set(prev_files), set(cur_files)
    added = sorted(cur - prev)
    removed = sorted(prev - cur)
    changed = sorted(
        p for p in (cur & prev) if prev_files[p]["sha1"] != cur_files[p]["sha1"]
    )
    return added, changed, removed


def top_level_map(cur_files: dict) -> dict:
    """Count tracked files per top-level area, for orientation."""
    areas = {}
    for rel in cur_files:
        head = rel.split(os.sep, 1)[0]
        key = head if (os.sep in rel) else "(root)"
        areas[key] = areas.get(key, 0) + 1
    return dict(sorted(areas.items(), key=lambda kv: (-kv[1], kv[0])))


# First-run reading list. Unlike GIST, this repo HAS a CLAUDE.md and a pair
# of design docs — read those first (they are the source of truth for how to
# work here and why), THEN the load-bearing code: the orchestrator, the
# schema<->item mapping hook, the shared prompt contract, and both backends.
FIRST_RUN_HINTS = [
    "CLAUDE.md",
    "overview_April_7.md",
    "Dev_Tasks.md",
    "src/App.jsx",
    "src/hooks/useSvgs.js",
    "src/lib/constants.js",
    "shared/system_prompt.json",
    "modal_functions/generate_svg.py",
    "api/generate.ts",
    "gist-supabase-schema.sql",
]


def main():
    ap = argparse.ArgumentParser(description="get-up-to-speed project digest")
    ap.add_argument("--commit", action="store_true",
                    help="save current state as the new onboarding snapshot")
    args = ap.parse_args()

    root = Path.cwd()
    cur = scan(root)
    man = load_manifest()
    prev_files = man.get("files", {})
    committed_at = man.get("committed_at")

    added, changed, removed = diff(prev_files, cur)
    first_run = not man

    print(f"# get-up-to-speed  ({root.name})")
    print(f"  root        : {root}")
    print(f"  tracked     : {len(cur)} files ({', '.join(sorted(TRACK_EXT))})")
    if first_run:
        print("  last digest : never  -> FIRST RUN: read the docs + code, this is the baseline")
    else:
        print(f"  last digest : {committed_at}")
    print()

    print("## project map (tracked files per area)")
    for area, n in top_level_map(cur).items():
        print(f"  {n:>4}  {area}")
    print()

    if first_run:
        print("## what to read (first run)")
        print("  Start with the hand-maintained docs (state + rationale), then")
        print("  the load-bearing code they describe:")
        for hint in FIRST_RUN_HINTS:
            if (root / hint).exists():
                print(f"    - {hint}")
        print("    - src/hooks/*.js              (useSvgs, useGeneration, useGenerationQueue)")
        print("    - src/components/*.jsx        (DetailModal, QueuePanel, the modals)")
        print("    - api/*.ts                    (Vercel thin auth proxies)")
        print("    - modal_functions/*.py        (Modal: generate_svg, keep_alive)")
    else:
        print("## changed since last digest")
        if not (added or changed or removed):
            print("  (nothing changed — you are already up to speed)")
        for p in added:
            print(f"  + NEW       {p}")
        for p in changed:
            print(f"  ~ MODIFIED  {p}")
        for p in removed:
            print(f"  - REMOVED   {p}")
    print()

    print("## context pointers")
    claude_docs = [
        c for c in sorted(root.glob("**/CLAUDE*.md"))
        if SELF_DIR not in c.relative_to(root).parents
        and not any(d in c.relative_to(root).parts for d in SKIP_DIRS)
    ]
    if claude_docs:
        for c in claude_docs:
            print(f"  CLAUDE doc : {c.relative_to(root)}")
    else:
        print("  CLAUDE doc : (none found — expected CLAUDE.md at the root)")
    for doc in ("overview_April_7.md", "Dev_Tasks.md"):
        print(f"  design doc : {doc}  [{'exists' if (root / doc).exists() else 'MISSING'}]")
    mem = memory_dir(root)
    idx = mem / "MEMORY.md"
    print(f"  memory dir : {mem}  [{'exists' if mem.exists() else 'MISSING — create it'}]")
    print(f"  MEMORY.md  : [{'exists' if idx.exists() else 'MISSING — seed it'}]")
    print()

    if args.commit:
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(json.dumps({
            "version": 1,
            "committed_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "root": str(root),
            "files": cur,
        }, indent=2))
        print(f"## committed snapshot -> {MANIFEST.relative_to(root)}")
        print(f"  recorded {len(cur)} files as digested.")
    else:
        print("## next")
        print("  1. Read the files listed above.")
        print("  2. If code drifted from the docs, update CLAUDE.md / Dev_Tasks.md.")
        print("  3. Record durable, non-obvious facts to the memory dir (+ MEMORY.md index).")
        print("  4. Re-run with --commit to mark this state as digested.")


if __name__ == "__main__":
    main()
