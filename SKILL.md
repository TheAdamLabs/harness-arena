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

### Step 1 — Scan (orient + start in one command)

`harness scan` is the entry point. It checks for existing open work first, then returns ecosystem facts if the slate is clean:

```bash
harness scan ./my-repo --repo owner/repo
```

**Case A — open issues already exist (resume, don't duplicate):**
```json
{
  "existing": [{ "number": 14, "goal": "Add missing JSDoc", "status": "running" }],
  "next": "harness context 14 --repo owner/repo"
}
```
→ Read that context, then continue from Step 3.

**Case B — no open issues (start fresh):**
```json
{
  "ecosystem": "TypeScript / Node.js",
  "config": { "workdir": "/path/to/repo", "assertions": [...] },
  "next": "inspect the repo, form 2-4 specific improvement recommendations, ask the user which to pursue, then: harness open \"<chosen goal>\" --repo owner/repo --workdir /path/to/repo"
}
```
→ **Do not open an issue yet.** Inspect the repo first, then ask the user:

```
I scanned the repo and found a few things worth improving:

1. checker.ts has no unit tests (scanner and reporter are covered)
2. There are 3 TypeScript strict errors in src/reporter.ts
3. README examples reference the old task.json format

Which would you like me to tackle? Or do you have a different goal in mind?
```

Wait for the user's answer, then call `harness open` with the chosen goal.

**Shortcut — scan + open in one step:**
```bash
harness scan ./my-repo --repo owner/repo --goal "Fix all TypeScript errors in src/"
# → { number: "15", url: "...", ecosystem: "TypeScript / Node.js" }
```

### Step 2 — Open an issue (when scan returns no open work)

Use `harness open` for custom assertions or when you already know the goal:

```bash
harness open "Add JSDoc to all public functions in src/api.ts" \
  --repo owner/repo \
  --workdir /path/to/repo \
  --assert "npx tsc --noEmit" \
  --assert "grep -r '@param' src/api.ts"
# → { number: "16", url: "..." }
```

`harness open` also deduplicates — if an open issue with the same goal exists, it returns that issue instead of creating a new one.

### Step 3 — Resume an in-progress issue

Before touching code, always read the full history to avoid repeating failed attempts:

```bash
harness context 14
# → { goal, config, status, attempts: [ "Attempt 1: ...", "Attempt 2: ..." ] }
```

### Step 4 — preflight: gather context before touching anything

Before editing a single file, read the relevant code and run checks dry:

```bash
# Read the files your assertions will touch
cat /path/to/repo/src/api.ts

# Verify the assertions you're about to write will actually run
cd /path/to/repo && npx tsc --noEmit        # does tsc work at all?
cd /path/to/repo && npm test                # does test suite pass currently?
cd /path/to/repo && npx eslint . 2>&1 | head -20  # any pre-existing lint errors?

# Check peer deps before writing tool-specific assertions
node -e "require('@eslint/js')" 2>&1        # installed?
```

Common traps to avoid:
- **Fragile assertions** — don't assert against a live server or port that isn't running. Use file/output checks instead.
- **Unknown pre-existing failures** — run assertions once before doing any work to establish a baseline. If they already fail, fix that first or note it in `harness log`.
- **Missing peer deps** — if an assertion runs a tool (eslint, tsc, pytest), verify all its deps are installed before writing the assertion.
- **Too-narrow `old_string` in edits** — when replacing text in config files with repeated structure (JSON keys, YAML blocks), include enough surrounding context to uniquely identify the target.

### Step 5 — Do the actual work

Make the changes needed to satisfy the assertions:

```bash
# edit files using your tools
# ...

# sanity check before verifying with harness
cd /path/to/repo && npx tsc --noEmit
```

### Step 6 — Verify with harness

```bash
harness check 16
# ✅ shell: `npx tsc --noEmit`
# ❌ shell: `grep -r '@param' src/api.ts`
#    reason: exit 1 (expected 0)
#    stdout: (empty — grep found nothing)
# 1/2 assertions passed
```

The JSON output includes full `stdout`/`stderr` per assertion — no second round-trip needed to understand the failure.

### Step 7 — Commit, push, then close

Only close or fail an issue **after** the code is committed and pushed. This keeps the issue state honest — done means it's in the repo.

**All assertions pass:**
```bash
harness log 16 "Added @param/@returns to 8 functions. tsc clean, grep confirms."
git add -A && git commit -m "feat: add JSDoc to public functions in src/api.ts" && git push
harness done 16 1
```

**Assertion failed — log and retry (no push yet):**
```bash
harness log 16 "Attempt 1: added JSDoc to 5/8 functions. 3 still missing in src/api.ts lines 120-180."
# fix the remaining 3, then re-check...
harness check 16
harness log 16 "Attempt 2: all 8 functions documented. Both assertions pass."
git add -A && git commit -m "feat: complete JSDoc coverage in src/api.ts" && git push
harness done 16 2
```

**Genuinely blocked:**
```bash
harness log 16 "grep assertion impossible — file is auto-generated and overwritten on build."
harness fail 16 3
# No push needed — nothing was changed.
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

- **`--repo` is optional when inside a git repo** — harness resolves the GitHub remote automatically from `git remote get-url origin`. Only set `GITHUB_REPO` or `--repo` when working across repos or in a CI environment.
- **Always push before closing** — `git push` first, then `harness done`. The issue represents shipped work.
- **Always start with `harness scan`** — it checks for open issues automatically before returning ecosystem facts. No need to run `harness history` separately first.
- **`harness scan` never prompts** — it always outputs JSON. When there are no open issues, you inspect the repo, form recommendations, and ask the user before opening anything.
- **Always run `harness context <issue>` before resuming** — read what was tried before trying the same thing again.
- **One goal per issue, make it specific** — "Fix TypeScript error on line 42 of utils.ts" beats "Fix TypeScript".
- **Log every attempt** — comments are permanent context for future agents and humans.
- **`harness check` output is enough to understand failures** — stdout/stderr are included, no need to re-run the failing command.
- **`harness fail` early** if the goal is structurally impossible — keeps the issue backlog clean.
- **`--workdir`** — always set this to the repo root so assertions run in the right directory.
