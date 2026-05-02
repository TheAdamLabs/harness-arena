# harness

A protocol for making any software project continuously more valuable — autonomously, across unlimited sessions.

**You are the agent. Use your native tools (Shell, Read, Write) to run the loop.**

---

## The goal

"Better" means better for real users — not just greener CI. The highest-value improvements come from running the project as a user would, observing what breaks or feels wrong, and fixing that. Ask: *"Does this actually work?"* before *"Does `npm test` pass?"*

---

## The loop

```
HARNESS.json exists in the target repo?
  YES → read it → continue the active task (skip to Step 3)
  NO  → Step 1: orient
```

### Step 1 — Orient (no active task)

**First: check guards.** If `HARNESS_GUARDS.json` exists, run each entry's assertions via Shell before doing anything else. If any fail, that regression is the task — go to Step 2 with it.

```bash
# Example guard check
node tests/nth_visible.mjs   # exit 1 → regression found
```

**Then: run the project as a real user would.** Don't read source code first — use the project.

```bash
# CLI tool
cd /path/to/repo && cat README.md   # understand what it claims to do
node bin/cli.mjs --help             # try it
node bin/cli.mjs <real command>     # does it actually work?

# Server
npm start & sleep 2 && curl http://localhost:3000/...

# Chrome extension
# load the extension, open devtools, exercise it manually in the browser

# Library
# run the README example verbatim
```

Observe what breaks, feels wrong, or is missing. Form 2–4 specific improvement recommendations across different dimensions:

- **Real-world correctness** — does it do what it claims on real inputs?
- **Usability** — does a first-time user succeed? Are error messages actionable?
- **Reliability** — what breaks on bad inputs, network failures, edge cases?
- **Value** — what problems does it not yet solve? What workflows are clunky?
- **Performance** — is it fast enough to be practical?
- **Code quality** — only after the above

Ask the user which to pursue. Then go to Step 2.

### Step 2 — Start a task

Write `HARNESS.json` in the target repo. For a single issue:

```json
{
  "goal": "specific, one-sentence description of what you will fix",
  "assertions": [
    "node tests/my_behavior.mjs",
    "npm test"
  ],
  "log": []
}
```

For multiple issues found in orient (track each explicitly):

```json
{
  "goal": "Fix N behavioral bugs found in orient",
  "items": [
    { "issue": "get_network timestamps are wrong (monotonic vs Unix ms)", "done": false },
    { "issue": "CLI exits 0 on logical failures like find_element not found", "done": false },
    { "issue": "scroll can't target a specific area on the page", "done": false }
  ],
  "assertions": [],
  "log": []
}
```

Mark each `"done": true` as you verify it. Add assertions as you go — one per item minimum.

**Choosing assertions:** Prefer behavioral — commands that run the actual system and check its output. Structural checks (`tsc`, `grep`, `npm test`) are fine as a secondary signal but can't be the only verification for behavioral goals.

Commit `HARNESS.json` so any future session can pick up where you left off.

### Step 3 — Do the work

Make the changes. After each meaningful attempt — especially a failed one — append to the log with specifics:

```json
"log": [
  "Attempt 1 [FAILED]: tried Cmd+A via CDP key events to select-all before typing. Modifier keypress doesn't trigger select-all in native inputs — CDP doesn't synthesize the right event. Approach abandoned.",
  "Attempt 2 [PASS]: used Runtime.evaluate to call el.select() directly. Works on native inputs."
]
```

Log the *specific reason* an approach failed, not just that it failed. Future sessions read this to avoid repeating dead ends.

Before retrying, read the full log. Don't repeat failed approaches.

### Step 4 — Verify

Run each assertion in `HARNESS.json` via Shell. Check the exit code and output.

If assertions pass: **also exercise the system live** — actually run it and confirm the behavior changed. Assertions passing is necessary but not sufficient. The ground truth is: does it work when you use it?

If something fails, log the attempt (with the specific reason) and continue from Step 3.

### Step 5 — Ship

Once assertions pass and live verification confirms the fix:

```bash
git add -A && git commit -m "fix: <description>"
git push
```

**Before deleting HARNESS.json, persist the assertions as guards.** Read `HARNESS_GUARDS.json` (create it if absent), append an entry, write it back:

```json
[
  {
    "goal": "get_network timestamps use Unix ms not Chrome monotonic uptime",
    "assertions": ["node tests/network_ts.mjs"]
  }
]
```

Only include behavioral assertions in guards — structural checks like `tsc` add noise without catching real regressions. Then delete HARNESS.json and commit:

```bash
git rm HARNESS.json
git add HARNESS_GUARDS.json
git commit -m "chore: close task — <goal>"
git push
```

Loop back to Step 1.

---

## If you're blocked

If a goal is structurally impossible (wrong assertions, wrong approach, external blocker): log what you tried and why, then delete `HARNESS.json` and note the abandonment in the commit message. Don't update `HARNESS_GUARDS.json` — only guards that passed live verification belong there.

---

## Assertions reference

**The pattern: start system → exercise it → assert on observable output → stop system.**

| Project type | Behavioral assertion pattern |
|---|---|
| CLI tool | `node bin/cli.mjs <cmd> \| node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!d.field)process.exit(1)"` |
| HTTP server | `npm start &>/tmp/s.log & sleep 2 && curl -sf http://localhost:3000/health && kill %1` |
| Chrome extension | exercise via browser devtools / manual reload; document what was tested in the log since assertions can't run headlessly |
| Library | `node -e "const lib=require('.');const r=lib.fn(input);if(r!==expected)process.exit(1)"` |
| Structural fallback | `npx tsc --noEmit`, `npm test`, `cargo clippy`, `python -m pytest`, `go test ./...` |

Structural assertions belong in `assertions` as a secondary signal. Only behavioral assertions belong in `HARNESS_GUARDS.json`.
