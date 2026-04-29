# harness-arena

Use the **Shell tool** to run `harness COMMAND` commands.

## What harness is

harness is a **loop coordinator and GitHub Issues tracker** for autonomous repo improvement.

**High-level goal:** make any software project continuously more valuable — autonomously, across unlimited sessions and agents. The loop closes itself: scan → goal → work → verify → ship → scan again. Each closed issue leaves the project measurably better than before, and leaves a regression guard so it stays that way.

**"Better" means more than tests passing.** Think like a product engineer, not a code reviewer. Ask: *"What would make this more useful to its users?"* before *"What code issues can I find?"* The highest-value improvements are usually discovered by running the project as a real user would — not by scanning source code.

**You do the work. harness tracks it and verifies it.**

The GitHub Issue is the single source of truth — no local task files. Any agent on any machine picks up work by issue number alone.

```
harness scan ./repo  →  regressions + open issues  →  ecosystem facts if clear
you inspect the repo  →  ask user for goal
harness open "<goal>"  →  issue #42 (baseline run + assertions stored inside)
you do the work        →  edit files, run commands
harness check 42       →  assertions pass or fail (with full output)
git push && harness done 42  →  issue closed ✅  +  assertions added to regression manifest
       ↕
harness context 42   →  read prior attempts before retrying
harness observe "bug found mid-run"  →  triage draft, continue active issue
```

## Prerequisites

```bash
harness help
# Not found? cd /path/to/harness-arena && npm install && npm run build && npm install -g .
# Requires GITHUB_TOKEN; GITHUB_REPO=owner/repo is optional (auto-detected from git remote)
```

## Command reference

```bash
harness help
harness scan    <workdir> [--repo R] [--goal "..."]
  # Checks regressions from HARNESS_REGRESSION.json, then open issues, then ecosystem.
  # With --goal: opens issue immediately (baseline run included).

harness open    "<goal>" [--repo R] [--workdir P] [--type TYPE] [--assert "cmd"]...
  # TYPE: fix | correctness | performance | workflow | spike
  # Runs assertions as a baseline before creating the issue.
  # Warns when a similar open issue exists (fuzzy title match).

harness check   <issue>  [--workdir override]    # run assertions → PASS/FAIL + output
harness log     <issue>  "<message>" [--outcome pass|fail|blocked] [--duration <s>] [--files a,b]
harness context <issue>                          # read goal + config + all prior attempts
harness history [--repo R]                       # list all harness issues
harness done    <issue>  [attempts]              # close ✅ + append assertions to HARNESS_REGRESSION.json
harness fail    <issue>  [attempts]              # mark ❌ (leave open)
harness observe "<observation>" [--repo R]       # log a triage draft without derailing active issue
```

---

## The autonomous improvement loop

### Step 1 — Scan (orient + detect regressions)

`harness scan` is always the entry point. Order of checks:
1. Runs `HARNESS_REGRESSION.json` assertions → regressions from previously closed issues
2. Checks for open `harness:running` issues → resume hint
3. Returns ecosystem facts → you decide the goal

```bash
harness scan ./my-repo --repo owner/repo
```

**Case A — regressions detected:**
```json
{
  "regressions": [
    { "issue": "8", "goal": "chain sharp pipeline", "failed": ["npm test"] }
  ],
  "next": "fix regressions first, or open a new issue"
}
```
→ Address the regression (open a new issue for it), then scan again.

**Case B — open issues already exist (resume, don't duplicate):**
```json
{
  "existing": [{ "number": 14, "goal": "Add missing JSDoc", "status": "running" }],
  "next": "harness context 14 --repo owner/repo"
}
```
→ Read that context, then continue from Step 3.

**Case C — slate is clean (start fresh):**
```json
{
  "ecosystem": "TypeScript / Node.js",
  "config": { "workdir": "/path/to/repo", "assertions": [...] },
  "regressions": [],
  "next": "inspect the repo, form 2-4 specific improvement recommendations, ask the user which to pursue..."
}
```
→ **Do not open an issue yet.** Inspect the project holistically first — then ask the user.

**How to inspect holistically:** Read the README to understand what the project does and who uses it. Then look at the project from multiple angles:

- **Real-world correctness** — run the project as a user would. Does it actually do what it claims? What breaks on real inputs?
- **Usability** — try the first-time experience. Are docs accurate? Do error messages tell you what to do?
- **Missing value** — what user problems does it not yet solve? What workflows are clunky?
- **Reliability** — what happens on bad inputs, network failures, edge cases?
- **Code quality** — types, tests, lint. But only after the above.

Then form 2–4 recommendations spanning different dimensions — not just code quality. Example for a browser automation tool:

```
I looked at tiny-browser as a user would. Here's what I found:

1. [Real-world correctness] nth selector returns wrong element on pages where the
   first match is hidden — needs a test that actually runs the browser and verifies
   the returned element is the visible one, not the first in the DOM.

2. [Performance] Screenshots take ~3s on high-DPI displays due to a missing DPR
   scale factor. Could be ~300ms. Has a test that catches this.

3. [Usability] The README example uses a workflow that requires Chrome to already
   be open, but there's no instruction for how to open it. First-time users fail here.

4. [Value] There's no way to wait for a specific element to appear before interacting.
   Most real workflows need this (page loads, AJAX). Would unlock a whole class of use cases.

Which would you like me to tackle? Or do you have something else in mind?
```

Wait for the user's answer, then call `harness open` with the chosen goal.

### Step 2 — Open an issue

After the user picks a goal, open a tracking issue with assertions. The **baseline** (current pass/fail) is automatically recorded in the issue body.

```bash
harness open "Add JSDoc to all public functions in src/api.ts" \
  --repo owner/repo \
  --workdir /path/to/repo \
  --type fix \
  --assert "npx tsc --noEmit" \
  --assert "grep -rc '@param' src/api.ts"
# → { number: "16", url: "..." }
# Baseline is run automatically. If assertions already pass, a warning is printed
# ("verify your goal isn't already complete"). Heed it.
```

**Choosing `--type` wisely:**
- `fix` — structural change; file/grep assertions are fine
- `correctness` — must use **behavioral assertions** (run the actual system, check its output)
- `performance` — must include a timing measurement assertion
- `workflow` — end-to-end run + report file check
- `spike` — exploration only; produces observations, not code. Use `harness log` to record findings.

**Fuzzy dedup warning:** If a similar open issue exists (>50% word overlap in title), harness prints a warning with the matching issue number. Review before proceeding.

### Step 3 — Resume an in-progress issue

Before touching code, always read the full history to avoid repeating failed attempts:

```bash
harness context 14
# → { goal, config (type + assertions + workdir), status, baseline, attempts: [...] }
```

### Step 4 — Preflight: understand the project and gather context

Before editing a single file:

**Understand what the project does and how users use it:**
```bash
cat /path/to/repo/README.md          # what does this project do? who uses it?
cat /path/to/repo/package.json       # what are the entry points and scripts?
ls /path/to/repo/                    # what's the overall structure?
```

**Run the project as a real user would** — this is where the most valuable improvement ideas come from:
```bash
# For a CLI tool: actually run it
cd /path/to/repo && node bin/cli.mjs --help
cd /path/to/repo && node bin/cli.mjs <real command>

# For a server: start it and exercise it
cd /path/to/repo && npm start &
curl http://localhost:3000/...

# For a library: run the examples from the README
```

**Verify the assertions you plan to write will actually run:**
```bash
cd /path/to/repo && npx tsc --noEmit        # does tsc work at all?
cd /path/to/repo && npm test                # does test suite pass currently?
node -e "require('@eslint/js')" 2>&1        # are peer deps installed?
```

Common traps:
- **Only reading source code** — the most important issues are usually only visible when you actually run the project. Read the code *and* run it.
- **All-structural assertions on correctness goals** — if the goal is behavioural ("fix nth selector"), use a shell assertion that actually invokes the system and checks its output, not just `grep` on source code.
- **Fragile assertions** — don't assert against a live server/port that isn't started by the assertion itself.
- **Assertion gaming** — the baseline tells you what currently fails. If your change makes all assertions pass but the baseline showed them passing too, you changed nothing meaningful.
- **Missing peer deps** — verify all tools are installed before writing assertions.
- **Too-narrow `old_string` in edits** — include enough surrounding context to uniquely identify the replacement target.

### Step 5 — Do the actual work

Make the changes needed to satisfy the assertions. For `--type spike` issues, record observations with `harness observe` instead of writing code:

```bash
# mid-workflow: spotted a bug that's out of scope for the current issue
harness observe "scroll fails on LinkedIn inner container — needs container targeting logic" --repo owner/repo
# → creates harness:triage issue #28, continue current issue
```

### Step 6 — Verify with harness

```bash
harness check 16
# ✅ shell: `npx tsc --noEmit`
# ❌ shell: `grep -rc '@param' src/api.ts`
#    reason: exit 1 (expected 0)
#    stdout: src/api.ts:0
# 1/2 assertions passed
```

Full `stdout`/`stderr` per assertion is included — no second round-trip needed.

### Step 7 — Commit, push, then close

Only close or fail an issue **after** the code is committed and pushed. `harness done` appends the assertions to `HARNESS_REGRESSION.json` — these run on every future `harness scan` to catch regressions.

**All assertions pass:**
```bash
harness log 16 "Added @param/@returns to 8 functions. tsc clean, grep confirms." \
  --outcome pass --duration 180 --files src/api.ts
git add -A && git commit -m "feat: add JSDoc to public functions in src/api.ts" && git push
harness done 16 1
```

**Assertion failed — log and retry:**
```bash
harness log 16 "Attempt 1: 5/8 functions done. 3 still missing in lines 120–180." \
  --outcome fail --duration 60 --files src/api.ts
# fix the remaining 3, then re-check...
harness check 16
harness log 16 "Attempt 2: all 8 functions documented." --outcome pass --duration 45
git add -A && git commit -m "feat: complete JSDoc coverage in src/api.ts" && git push
harness done 16 2
```

**Genuinely blocked:**
```bash
harness log 16 "grep assertion impossible — file is auto-generated." --outcome blocked
harness fail 16 3
```

---

## Assertion cheat sheet

### Structural (use for `fix` type goals)
```json
{ "type": "shell", "command": "npx tsc --noEmit",     "expect": { "exitCode": 0 } }
{ "type": "shell", "command": "npm test",              "expect": { "exitCode": 0 } }
{ "type": "shell", "command": "cargo clippy",          "expect": { "exitCode": 0 } }
{ "type": "shell", "command": "python -m pytest",      "expect": { "exitCode": 0 } }
{ "type": "shell", "command": "go test ./...",         "expect": { "exitCode": 0 } }
{ "type": "shell", "command": "grep -r 'TODO' src/",  "expect": { "exitCode": 1 } }
{ "type": "file",  "path": "dist/index.js",           "expect": { "exists": true } }
{ "type": "file",  "path": "src/utils.ts",            "expect": { "contains": "@returns" } }
```

### Behavioural (required for `correctness` type goals)
These run the **actual system** and check its output — they can't be satisfied by restructuring source code alone.

```json
{ "type": "shell",
  "command": "node bin/cli.mjs find_element '{\"selector\":\"button\",\"nth\":1}' | node -e \"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(d.text==='A1') process.exit(1)\"",
  "expect": { "exitCode": 0 } }

{ "type": "shell",
  "command": "npm start &>/tmp/server.log & sleep 2 && curl -sf http://localhost:3000/health && kill %1",
  "expect": { "exitCode": 0 } }

{ "type": "shell",
  "command": "node bin/cli.mjs screenshot | node -e \"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(!d.path) process.exit(1)\"",
  "expect": { "exitCode": 0 } }
```

The pattern: **start system → exercise it → assert on observable output → stop system**.

---

## Tips for autonomous operation

- **`--repo` is optional inside a git repo** — harness reads `git remote get-url origin` automatically.
- **Always push before closing** — `git push` first, then `harness done`. `done` writes to `HARNESS_REGRESSION.json`.
- **`harness scan` always checks regressions first** — if a previously closed issue breaks, you'll see it before starting new work.
- **Baseline on open is free insurance** — if all assertions pass at open time, either your goal is already done or your assertions don't actually test the right thing.
- **Use `harness observe` mid-workflow** — when you spot a bug out of scope for the current issue, log it and keep going. Don't derail the active issue.
- **Spike first for exploratory work** — `harness open --type spike` creates a no-assertion exploration issue. Record findings with `harness log`, then promote to fix/correctness issues.
- **Structured log entries are queryable** — `--outcome`, `--duration`, and `--files` make history useful beyond reading it linearly.
- **`harness context` before retrying** — always. Don't repeat failed approaches.
- **One goal per issue, make it specific** — "Fix TypeScript error on line 42 of utils.ts" beats "Fix TypeScript".
- **`harness fail` early** if the goal is structurally impossible — keeps the backlog clean.
