# harness-arena

Use the **Shell tool** to run `harness COMMAND` commands.

## What harness is

harness is a **loop coordinator and GitHub Issues tracker** for autonomous repo improvement. You (the AI agent) decide *what* to do and *do it*. harness handles *tracking* and *verifying* outcomes.

```
you write task.json → harness open → you do the work → harness check → harness done/fail
                                                ↑              |
                              ← retry if assertions fail ──────┘
```

## Prerequisites — check install

```bash
harness help
# If not found: cd /path/to/harness-arena && npm install && npm run build && npm install -g .
```

Requires `GITHUB_TOKEN` and `GITHUB_REPO=owner/repo` env vars for GitHub Issues.

## Command reference

```bash
harness help                                   # full reference
harness open   <task.json>                     # open tracking issue → { number, url }
harness check  <task.json>                     # run assertions → PASS/FAIL + JSON
harness log    <issue-number> "<message>"      # add comment to issue
harness done   <issue-number> [attempts]       # close as succeeded
harness fail   <issue-number> [attempts]       # mark as failed (leave open)
```

## Task format

```json
{
  "goal":       "Fix all TypeScript type errors in src/",
  "repo":       "owner/repo",
  "workdir":    "/absolute/path/to/repo",
  "assertions": [
    { "type": "shell", "command": "npx tsc --noEmit",  "expect": { "exitCode": 0 } },
    { "type": "shell", "command": "npm test",           "expect": { "exitCode": 0 } },
    { "type": "file",  "path": "dist/index.js",         "expect": { "exists": true } }
  ]
}
```

**Assertions are the contract.** You define what success looks like. harness verifies it.

## The autonomous improvement loop

Use this pattern for every improvement task:

### Step 1 — Understand the repo

Before writing a task, inspect the repo so your assertions are accurate:

```bash
# Get an overview
git -C /path/to/repo log --oneline -10
git -C /path/to/repo status

# Find what's broken
cd /path/to/repo && npx tsc --noEmit 2>&1 | head -40
cd /path/to/repo && npm test 2>&1 | tail -30
```

### Step 2 — Write a focused task.json

One concrete goal per task. Vague goals produce bad results.

```json
{
  "goal": "Add return type annotations to all functions in src/utils.ts",
  "repo": "owner/repo",
  "workdir": "/path/to/repo",
  "assertions": [
    { "type": "shell", "command": "npx tsc --noEmit", "expect": { "exitCode": 0 } },
    { "type": "file",  "path": "src/utils.ts", "expect": { "contains": ": void" } }
  ]
}
```

### Step 3 — Open a tracking issue

```bash
export GITHUB_REPO=owner/repo
harness open task.json
# → { "number": "42", "url": "https://github.com/..." }
ISSUE=42
```

### Step 4 — Do the actual work

This is your job. Edit files, run commands, make changes:

```bash
# Read the file
cat /path/to/repo/src/utils.ts

# Make improvements (use your file editing tools)
# ...

# Verify your changes compile
cd /path/to/repo && npx tsc --noEmit
```

### Step 5 — Check assertions

```bash
harness check task.json
# → ✅ shell: `npx tsc --noEmit`
# → ✅ file: `src/utils.ts`
# → 2/2 assertions passed
# exit code 0 = success, 1 = failure
```

### Step 6 — Log and close or retry

**On success:**
```bash
harness log $ISSUE "Fixed return types on 5 functions. All type checks pass."
harness done $ISSUE 1
```

**On failure — log what you tried and retry:**
```bash
harness log $ISSUE "Attempt 1 failed: tsc still shows 3 errors in utils.ts — fixing now."
# ... fix more things ...
harness check task.json
harness log $ISSUE "Attempt 2: all assertions pass."
harness done $ISSUE 2
```

**Out of ideas (give up):**
```bash
harness log $ISSUE "Could not fix: error is in a generated file outside our control."
harness fail $ISSUE 3
```

## Patterns for common improvement tasks

### Fix type errors

```json
{
  "goal": "Fix TypeScript errors in src/",
  "assertions": [
    { "type": "shell", "command": "npx tsc --noEmit", "expect": { "exitCode": 0 } }
  ]
}
```

Work pattern: run `tsc --noEmit 2>&1 | head -50` → fix errors one file at a time → check.

### Make tests pass

```json
{
  "goal": "Fix failing tests in src/__tests__/",
  "assertions": [
    { "type": "shell", "command": "npm test -- --passWithNoTests", "expect": { "exitCode": 0 } }
  ]
}
```

Work pattern: run `npm test 2>&1 | tail -40` → read failing test → fix source → check.

### Improve documentation

```json
{
  "goal": "Add JSDoc to all exported functions in src/api.ts",
  "assertions": [
    { "type": "file", "path": "src/api.ts", "expect": { "contains": "@param" } },
    { "type": "shell", "command": "npx tsc --noEmit", "expect": { "exitCode": 0 } }
  ]
}
```

### Refactor with safety

```json
{
  "goal": "Rename UserData to User across the codebase",
  "assertions": [
    { "type": "shell", "command": "grep -r 'UserData' src/", "expect": { "exitCode": 1 } },
    { "type": "shell", "command": "npm test", "expect": { "exitCode": 0 } }
  ]
}
```

### Add a missing feature

```json
{
  "goal": "Add rate limiting to the /api/search endpoint",
  "assertions": [
    { "type": "shell", "command": "npm test -- --testPathPattern=search", "expect": { "exitCode": 0 } },
    { "type": "file",  "path": "src/middleware/rateLimit.ts", "expect": { "exists": true } }
  ]
}
```

## Tips

- **One goal, one task.** Smaller tasks are easier to verify and retry.
- **Assertions are the spec.** Make them precise — the looser they are, the less they prove.
- **Log everything.** `harness log` comments are permanent — they help future agents and humans understand what happened.
- **Read before writing.** Always inspect the target file/test before making changes.
- **Fail fast.** If assertion output shows the problem is structural (generated files, external deps), call `harness fail` early instead of exhausting retries.
- **workdir matters.** Shell assertions run in `workdir`, so set it to the repo root.
