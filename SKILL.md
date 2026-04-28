# harness-arena

Use the **Shell tool** to run `harness COMMAND` commands.

## What harness is

harness is a **loop coordinator and GitHub Issues tracker** for autonomous repo improvement.

**You do the work. harness tracks it and verifies it.**

The GitHub Issue is the single source of truth — no local task files. Any agent on any machine picks up work by issue number alone.

```
harness scan ./repo  →  issue #42 (goal + assertions stored inside)
you do the work      →  edit files, run commands
harness check 42     →  assertions pass or fail (with full output)
harness done 42      →  issue closed ✅
       ↕
harness context 42   →  read prior attempts before retrying
```

## Prerequisites

```bash
harness help
# Not found? cd /path/to/harness-arena && npm install && npm run build && npm install -g .
# Requires GITHUB_TOKEN and GITHUB_REPO=owner/repo
```

## Command reference

```bash
harness help                                        # full reference
harness scan    <workdir> [--repo R] [--goal "..."] # detect ecosystem → open issue
harness open    "<goal>"  --repo R [--workdir P] [--assert "cmd"]...  # open issue inline
harness check   <issue>  [--workdir override]       # run assertions → PASS/FAIL + output
harness log     <issue>   "<message>"               # add attempt comment
harness context <issue>                             # read goal + config + all prior attempts
harness history [--repo R]                          # list all harness issues for the repo
harness done    <issue>  [attempts]                 # close as succeeded
harness fail    <issue>  [attempts]                 # mark as failed (leave open)
```

## The autonomous improvement loop

### Step 1 — Orient yourself

Before starting anything, check existing work to avoid duplication:

```bash
harness history --repo owner/repo
# → ✅ #12  Fix TypeScript errors            2026-04-28
# → 🔄 #14  Add missing JSDoc                2026-04-28
# → ❌ #11  Add rate limiting middleware      2026-04-27
```

To resume a failed or in-progress issue, read its history first:

```bash
harness context 14
# → { goal, config, status, attempts: [ "Attempt 1: ...", "Attempt 2: ..." ] }
```

### Step 2 — Start a new task

**Auto-detect ecosystem (recommended for any project):**

```bash
harness scan ./my-repo --repo owner/repo
# detects TypeScript/Node/Rust/Python/Go/Makefile automatically
# → { number: "15", url: "...", ecosystem: "TypeScript / Node.js", goal: "Ensure all checks pass" }
```

**Custom goal with inline assertions:**

```bash
harness open "Add JSDoc to all public functions in src/api.ts" \
  --repo owner/repo \
  --workdir /path/to/repo \
  --assert "npx tsc --noEmit" \
  --assert "grep -r '@param' src/api.ts"
# → { number: "16", url: "..." }
```

Both commands deduplicate automatically — if an open issue with the same goal already exists, the existing issue is returned.

### Step 3 — Do the actual work

This is entirely your responsibility. Read files, edit code, run commands:

```bash
cat /path/to/repo/src/api.ts
# understand what needs changing

# edit the file using your tools
# ...

# sanity check your changes
cd /path/to/repo && npx tsc --noEmit
```

### Step 4 — Verify with harness

```bash
harness check 16
# ✅ shell: `npx tsc --noEmit`
# ❌ shell: `grep -r '@param' src/api.ts`
#    reason: exit 1 (expected 0)
#    stdout: (empty — grep found nothing)
# 1/2 assertions passed
```

The JSON output includes full `stdout`/`stderr` per assertion — no second round-trip needed to understand the failure.

### Step 5 — Log and close or retry

**All assertions pass:**
```bash
harness log 16 "Added @param/@returns to 8 functions. tsc clean, grep confirms."
harness done 16 1
```

**Assertion failed — log and retry:**
```bash
harness log 16 "Attempt 1: added JSDoc to 5/8 functions. 3 still missing in src/api.ts lines 120-180."
# fix the remaining 3...
harness check 16
harness log 16 "Attempt 2: all 8 functions documented. Both assertions pass."
harness done 16 2
```

**Genuinely blocked:**
```bash
harness log 16 "grep assertion impossible — file is auto-generated and overwritten on build."
harness fail 16 3
```

## Assertion cheat sheet

```json
{ "type": "shell", "command": "npx tsc --noEmit",      "expect": { "exitCode": 0 } }
{ "type": "shell", "command": "npm test",               "expect": { "exitCode": 0 } }
{ "type": "shell", "command": "cargo clippy",           "expect": { "exitCode": 0 } }
{ "type": "shell", "command": "python -m pytest",       "expect": { "exitCode": 0 } }
{ "type": "shell", "command": "go test ./...",          "expect": { "exitCode": 0 } }
{ "type": "shell", "command": "grep -r 'TODO' src/",   "expect": { "exitCode": 1 } }
{ "type": "file",  "path": "dist/index.js",            "expect": { "exists": true } }
{ "type": "file",  "path": "src/utils.ts",             "expect": { "contains": "@returns" } }
```

## Tips for autonomous operation

- **Always run `harness history` first** — don't open duplicate issues.
- **Always run `harness context <issue>` before resuming** — read what was tried before trying the same thing again.
- **One goal per issue, make it specific** — "Fix TypeScript error on line 42 of utils.ts" beats "Fix TypeScript".
- **Log every attempt** — comments are permanent context for future agents and humans.
- **`harness check` output is enough to understand failures** — stdout/stderr are included, no need to re-run the failing command.
- **`harness fail` early** if the goal is structurally impossible — keeps the issue backlog clean.
- **`--workdir`** — always set this to the repo root so assertions run in the right directory.
