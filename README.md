# harness-arena

**Make any software project continuously more valuable — autonomously, across unlimited sessions.**

No CLI. No tokens. No build. Just a protocol and one JSON file.

---

## How it works

The entire system is [`SKILL.md`](./SKILL.md) — a protocol for AI agents — and a single JSON file (`HARNESS.json`) that lives in the target repo and tracks the active task.

The agent uses its native tools (`Shell`, `Read`, `Write`) to run the loop. No wrapper CLI needed.

```
HARNESS.json exists?
  YES → read it → continue the active task
  NO  → run the project as a real user → find what's broken → ask user → write HARNESS.json → work
```

## The philosophy

"Better for users" — not "CI is green." The highest-value improvements come from running the project as a real user would and observing what breaks or feels wrong. The agent asks *"does this actually work?"* before *"does `npm test` pass?"*

## Setup

Install the skill in Cursor (or any agent that reads skills):

```bash
git clone https://github.com/theadamlabs/harness-arena
# point your agent at SKILL.md, or copy it to ~/.cursor/skills/harness-arena/SKILL.md
```

No `npm install`. No `GITHUB_TOKEN`. No build step.

## HARNESS.json

One file in the target repo:

```json
{
  "goal": "nth selector returns wrong element when first match is hidden",
  "assertions": [
    "node tests/nth_visible.mjs",
    "npm test"
  ],
  "log": [
    "Attempt 1: fixed selector logic in core.js. npm test passes, nth_visible still wrong."
  ]
}
```

Commit it so any future session (or agent on another machine) can pick up where you left off. Delete it when the task is done.

## License

MIT
