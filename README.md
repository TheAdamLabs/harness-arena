# harness-arena

**Self-correcting task executor for AI coding agents.**

The harness is the *body* — it executes shell commands reliably, retries on transient failures, evaluates assertions, and surfaces everything to GitHub Issues. The AI agent is the *brain* — it authors tasks, reads results, and decides what to do next.

```
AI agent writes task.json → harness run task.json → result + GitHub Issue
     ↑                                                          |
     └───────────── agent reads issue, writes next task ────────┘
```

No LLM bundled. Bring your own agent (Cursor, Claude Code, any coding AI).

---

## Install

```bash
git clone https://github.com/theadamlabs/harness-arena
cd harness-arena
npm install && npm run build
npm install -g .
```

Requires `gh` CLI authenticated (`gh auth login`) for GitHub Issues observability.

---

## Usage

```bash
harness run task.json            # execute a task
harness validate task.json       # check schema without running
harness help                     # full reference
```

Set `GITHUB_REPO=owner/repo` (or add `"repo"` to the task) to enable GitHub Issues.

---

## Task format

```json
{
  "goal": "Add JSDoc to all exported functions in src/utils.ts",
  "repo": "theadamlabs/my-project",
  "workdir": "/path/to/cloned/repo",
  "maxRetries": 3,
  "steps": [
    { "type": "shell", "command": "npm ci" },
    { "type": "shell", "command": "npx tsc --noEmit" },
    { "type": "file",  "action": "write", "path": "src/utils.ts", "content": "..." },
    { "type": "shell", "command": "git add src/utils.ts" },
    { "type": "shell", "command": "git commit -m 'docs: add JSDoc to utils'" }
  ],
  "assertions": [
    { "type": "shell", "command": "npx tsc --noEmit", "expect": { "exitCode": 0 } },
    { "type": "file",  "path": "src/utils.ts", "expect": { "contains": "@param" } }
  ]
}
```

### Step types

| type    | fields                                                      |
|---------|-------------------------------------------------------------|
| `shell` | `command`, `cwd?`, `env?`, `timeout?` (ms, default 60 000) |
| `file`  | `action` (write/append/delete), `path`, `content?`         |

### Assertion expects

**shell assertions** — runs the command and checks:

| key           | type    | meaning                                     |
|---------------|---------|---------------------------------------------|
| `exitCode`    | number  | process must exit with this code (default 0)|
| `contains`    | string  | stdout+stderr must include this string      |
| `notContains` | string  | stdout+stderr must NOT include this string  |

**file assertions** — inspects a file path:

| key           | type    | meaning                              |
|---------------|---------|--------------------------------------|
| `exists`      | boolean | file must or must not exist          |
| `contains`    | string  | file content must include string     |
| `notContains` | string  | file content must NOT include string |

---

## GitHub Issues observability

When `repo` is set, every task run:

| Event              | GitHub action                                             |
|--------------------|-----------------------------------------------------------|
| Task starts        | Opens issue titled `[harness] <goal>`, label `harness:running` |
| Attempt N fails    | Adds comment with per-step log (stdout, stderr, exit code)|
| All retries done   | Swaps label to `harness:failed`, leaves issue open        |
| Assertions pass    | Closes issue, label `harness:succeeded`                   |

Labels are created automatically on first run (`--force` to update descriptions).

---

## Self-correction strategies

The harness applies one in-place correction per step before counting a retry:

| Error class   | Automatic correction                        |
|---------------|---------------------------------------------|
| `timeout`     | Sleep 2 s, retry step                       |
| `network`     | Sleep 3 s, retry step                       |
| `not_found`   | Run `npm install` if a Node binary is missing, retry step |
| `hard`        | Abort attempt immediately                   |

Retry backoff between full attempts: `1 000 ms × attempt number`.

---

## How an AI agent uses this

The agent is responsible for generating each task. The harness is responsible for executing it faithfully and reporting what happened. A typical loop:

1. **Agent:** clone the target repo, inspect it (`git log`, `tsc --noEmit`, `npm test`).
2. **Agent:** identify one concrete improvement (failing test, type error, missing doc).
3. **Agent:** write a `task.json` describing the steps to fix it.
4. **Agent:** call `harness run task.json`.
5. **Harness:** executes, retries on transient errors, files GitHub Issue.
6. **Agent:** reads result JSON (stdout) and the GitHub Issue for full detail.
7. **Agent:** if `ok: false`, generate a corrected task and go to step 4.
8. **Agent:** if `ok: true`, pick the next improvement and go to step 2.

The harness never decides *what* to improve — only *whether the steps succeeded*.

---

## Project structure

```
src/
  types.ts      — Task, Step, Assertion, StepResult interfaces
  executor.ts   — step execution (shell + file) and assertion evaluation
  reporter.ts   — GitHub Issues via gh CLI
  runner.ts     — retry loop, correction strategies
  index.ts      — CLI entry point
```

---

## License

MIT
