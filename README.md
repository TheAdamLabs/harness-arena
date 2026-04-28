# harness-arena

**Autonomous repo improvement loop coordinator for AI coding agents.**

The GitHub Issue is the single source of truth — no local task files. Any agent on any machine picks up work by issue number alone.

```mermaid
flowchart TD
    subgraph agent [AI Agent]
        orient["harness history\nharness context"]
        work["Make improvements\nedit files, fix errors"]
        next["Pick next improvement"]
    end

    subgraph harness_cli [harness CLI]
        scan["harness scan\nharness open"]
        check["harness check"]
        logCmd["harness log"]
        done["harness done"]
        failCmd["harness fail"]
    end

    subgraph github [GitHub Issue]
        running(["#N: goal\nconfig + assertions\nharness:running"])
        succeeded(["#N closed\nharness:succeeded"])
        failed(["#N open\nharness:failed"])
    end

    orient -->|"no prior issue"| scan
    orient -->|"existing issue"| work
    scan --> running
    running --> work
    work --> check
    check -->|"all pass"| logCmd
    logCmd -->|success| done
    done --> succeeded
    succeeded --> next
    next --> orient

    check -->|"assertion failed"| logCmd
    logCmd -->|"retries left"| work
    logCmd -->|"no retries"| failCmd
    failCmd --> failed
    failed -.->|"agent picks up later"| orient
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

Requires `GITHUB_TOKEN` for GitHub Issues and `GITHUB_REPO=owner/repo` as default repo.

---

## Commands

```bash
harness scan    <workdir> [--repo R] [--goal "..."]       # auto-detect ecosystem → open issue
harness open    "<goal>"  --repo R [--assert "cmd"]...    # open issue with inline assertions
harness check   <issue>  [--workdir override]             # run assertions, print PASS/FAIL + output
harness log     <issue>   "<message>"                     # add comment (attempts, errors, notes)
harness context <issue>                                   # read goal + config + all prior attempts
harness history [--repo R]                                # list all harness issues for the repo
harness done    <issue>  [attempts]                       # close as succeeded
harness fail    <issue>  [attempts]                       # mark as failed, leave open
harness help                                              # full reference
```

---

## How it works

The issue body stores everything harness needs in a hidden HTML comment:

```
<!-- harness:config
{"workdir":"/path/to/repo","assertions":[{"type":"shell","command":"npx tsc --noEmit","expect":{"exitCode":0}}]}
-->
```

`harness check 42` fetches issue #42, extracts the config, runs the assertions, and returns the full result including stdout/stderr — so the agent immediately sees what failed without needing a second command.

---

## Assertion types

**`shell`** — run a command, check its output:

| field         | meaning                                      |
|---------------|----------------------------------------------|
| `command`     | shell command to run                         |
| `exitCode`    | expected exit code, default `0`              |
| `contains`    | stdout+stderr must include this string       |
| `notContains` | stdout+stderr must NOT include this string   |
| `cwd`         | directory override (relative to workdir)     |

**`file`** — inspect a file on disk:

| field         | meaning                              |
|---------------|--------------------------------------|
| `path`        | path relative to workdir             |
| `exists`      | file must or must not exist          |
| `contains`    | file content must include string     |
| `notContains` | file content must NOT include string |

---

## Ecosystem auto-detection (`harness scan`)

`harness scan` reads the directory and generates sensible assertions automatically:

| Detected files                    | Ecosystem         | Assertions generated                   |
|-----------------------------------|-------------------|----------------------------------------|
| `package.json` + `tsconfig.json`  | TypeScript/Node   | `tsc --noEmit`, eslint, `npm test`     |
| `package.json`                    | Node.js           | `npm test`                             |
| `Cargo.toml`                      | Rust              | `cargo check`, `cargo clippy`, `cargo test` |
| `pyproject.toml` / `setup.py`     | Python            | ruff, mypy (if configured), `pytest`   |
| `go.mod`                          | Go                | `go build`, `go vet`, `go test`        |
| `Makefile`                        | Make              | `make test`, `make lint`, `make build` |

---

## GitHub Issues observability

| Event             | GitHub action                                          |
|-------------------|--------------------------------------------------------|
| `harness scan/open` | Creates issue, embeds config, label `harness:running` |
| Duplicate goal    | Returns existing open issue instead of creating new    |
| `harness log`     | Adds comment (attempt details, errors, diffs)          |
| `harness done`    | Closes issue, label `harness:succeeded`                |
| `harness fail`    | Labels `harness:failed`, leaves open for future agents |
| `harness context` | Fetches issue + all comments as structured JSON        |
| `harness history` | Lists all harness issues (running / succeeded / failed)|

---

## Project structure

```
src/
  types.ts     — HarnessConfig, Assertion, IssueContext interfaces
  scanner.ts   — ecosystem detection
  checker.ts   — assertion evaluation with rich stdout/stderr output
  reporter.ts  — GitHub Issues via @octokit/rest
  index.ts     — CLI entry point
SKILL.md       — agent usage guide (auto-installed to ~/.cursor/skills/)
```

---

## License

MIT
