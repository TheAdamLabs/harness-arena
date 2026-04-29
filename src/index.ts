#!/usr/bin/env node
/**
 * harness — autonomous repo improvement loop coordinator.
 *
 * GitHub Issues are the single source of truth.
 * No task.json required. Any agent on any machine picks up work by issue number.
 *
 * Commands:
 *   harness scan    <workdir> [--repo owner/repo] [--goal "..."]
 *   harness open    "<goal>"  --repo owner/repo   [--workdir path] [--assert "cmd"]...
 *   harness check   <issue>                       [--workdir override]
 *   harness log     <issue>   "<message>"
 *   harness done    <issue>   [attempts]
 *   harness fail    <issue>   [attempts]
 *   harness context <issue>
 *   harness history [--repo owner/repo]
 *   harness help
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Suppress @octokit deprecation notices. They come via two channels:
//   1. console.warn() from the `deprecation` package ("[@octokit/request] ... is deprecated")
//   2. process.emitWarning() in some Node.js versions
// Both are years-out API-sunset notices, not actionable errors.
const _origWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const msg = args.map(String).join(' ');
  if (msg.includes('@octokit') && msg.includes('deprecated')) return;
  _origWarn(...args);
};
process.on('warning', (w) => {
  if (w.message.includes('@octokit') && w.message.includes('deprecated')) return;
  process.stderr.write(`${w.name}: ${w.message}\n`);
});

import { parseArgs, flag, flags } from './args.js';
import { check, formatCheckResult } from './checker.js';
import {
  openIssue, addComment, closeAsSucceeded, markAsFailed,
  getContext, listIssues, observeIssue,
} from './reporter.js';
import { scan, detectRepo, readRegressionManifest, writeRegressionManifest } from './scanner.js';
import type { Args } from './args.js';
import type { HarnessConfig, Assertion, IssueType } from './types.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SKILL_SRC  = path.resolve(__dir, '../SKILL.md');
const SKILL_DEST = path.join(os.homedir(), '.cursor', 'skills', 'harness-arena', 'SKILL.md');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function die(msg: string): never {
  process.stderr.write(`harness: ${msg}\n`);
  process.exit(1) as never;
  throw new Error('unreachable');
}

export function out(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

export function getRepo(flagValue?: string): string {
  // Priority: --repo flag > GITHUB_REPO env var > git remote in cwd
  const r = flagValue ?? process.env['GITHUB_REPO'] ?? detectRepo('.');
  if (!r) die('no repo — pass --repo owner/repo, set GITHUB_REPO, or run from inside a git repo');
  return r;
}

function installSkill(): void {
  try {
    if (!fs.existsSync(SKILL_SRC)) return;
    fs.mkdirSync(path.dirname(SKILL_DEST), { recursive: true });
    fs.copyFileSync(SKILL_SRC, SKILL_DEST);
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function helpText(): string {
  return `
harness — autonomous repo improvement loop coordinator

GitHub Issues are the single source of truth. No local task files needed.
Any agent on any machine picks up work by issue number alone.

COMMANDS

  harness scan <workdir> [--repo owner/repo] [--goal "..."]
    First checks GitHub for open harness issues. If any exist, returns them
    with a resume hint so you don't duplicate work.
    If the slate is clean, also runs HARNESS_REGRESSION.json assertions to
    detect regressions from previously closed issues.
    If clear, returns ecosystem facts for the agent to decide a goal.
    With --goal: opens a tracking issue immediately (runs baseline first).
    Prints { existing, next }  OR  { regressions, ... }  OR  { ecosystem, config, next }.

  harness open "<goal>" [--repo owner/repo] [--workdir path] [--type TYPE]
              [--assert "cmd"]...
    Open a tracking issue. Runs assertions as a baseline before creating the
    issue — records current pass/fail state in the issue body.
    Warns if a similar open issue already exists (fuzzy title match).
    TYPE: fix | correctness | performance | workflow | spike
    Each --assert adds a shell assertion with exitCode 0.
    Prints { number, url, goal, similar? }.

  harness check <issue-number> [--workdir override]
    Fetch config from the issue, run assertions, print PASS/FAIL + output.
    Exit 0 = all pass, 1 = at least one fails.
    Includes stdout/stderr in JSON so you don't need a second round-trip.

  harness log <issue-number> "<message>" [--outcome pass|fail|blocked]
              [--duration <seconds>] [--files <comma-list>]
    Add a structured attempt comment.

  harness done <issue-number> [attempts]
    Close issue as succeeded. Appends assertions to HARNESS_REGRESSION.json.

  harness fail <issue-number> [attempts]
    Mark issue as failed (leave open). Swaps label to harness:failed.

  harness observe "<observation>" [--repo owner/repo]
    Log a bug/observation mid-workflow without derailing the active issue.
    Creates a harness:triage draft. Promote to a real issue later.

  harness context <issue-number>
    Return the full issue: goal, config, type, baseline, all attempt comments.
    Read this before resuming work on an existing issue.

  harness history [--repo owner/repo]
    List all harness issues for the repo.

  harness help
    Show this help.

ENVIRONMENT

  GITHUB_TOKEN   Required for all GitHub API calls
  GITHUB_REPO    Default repo (owner/repo) — falls back to git remote in cwd

LOOP PATTERN  (see SKILL.md for the full guide)

  harness scan ./my-repo                            # checks regressions + open issues
  harness open "<goal>" --type correctness          # baseline run on open
  harness context <issue>                           # read prior attempts
  # ... preflight: read files, dry-run assertions ...
  # ... do the work ...
  harness check <issue>
  harness log <issue> "summary" --outcome pass --duration 120 --files src/foo.ts
  git add -A && git commit -m "..." && git push
  harness done <issue> 1
`;
}

// ---------------------------------------------------------------------------
// Command handlers — each returns an exit code; process.exit in dispatcher
// ---------------------------------------------------------------------------

export async function cmdScan(args: Args): Promise<number> {
  const workdir  = args.positional[0] ?? '.';
  const goalFlag = flag(args, 'goal');
  // Priority: --repo flag > git remote in workdir > GITHUB_REPO env var
  const repoFlag = flag(args, 'repo') ?? detectRepo(workdir) ?? process.env['GITHUB_REPO'];
  if (!repoFlag) die('could not detect GitHub repo — pass --repo owner/repo or set GITHUB_REPO');
  const repo = repoFlag;

  const existing = (await listIssues(repo)).filter((i) => i.status === 'running');
  if (existing.length > 0) {
    process.stderr.write(`[harness] ${existing.length} open issue(s) already in progress — resume before starting new work\n`);
    out({ existing, next: `harness context <issue-number> --repo ${repo}` });
    return 0;
  }

  // Run regression manifest — detect regressions from previously closed issues.
  const regressions: Array<{ issue: string; goal: string; failed: string[] }> = [];
  const manifest = readRegressionManifest(workdir);
  if (manifest.length > 0) {
    for (const entry of manifest) {
      const result = await check({ assertions: entry.assertions, workdir: path.resolve(workdir) });
      if (!result.ok) {
        regressions.push({
          issue: entry.issue,
          goal:  entry.goal,
          failed: result.results.filter((r) => !r.ok).map((r) =>
            r.assertion.type === 'shell'
              ? (r.assertion as { command: string }).command
              : (r.assertion as { path: string }).path
          ),
        });
      }
    }
    if (regressions.length > 0) {
      process.stderr.write(`[harness] ${regressions.length} regression(s) detected — address before starting new work\n`);
      out({ regressions, next: `fix regressions first, or open a new issue: harness open "<goal>" --repo ${repo}` });
      return 1;
    }
  }

  const result = scan(workdir, goalFlag);
  if (!result) die(`could not detect ecosystem in ${path.resolve(workdir)}`);

  if (goalFlag) {
    const baseline = result.config.assertions.length > 0
      ? await check(result.config)
      : undefined;
    const opened = await openIssue(goalFlag, result.config, repo, baseline);
    if (!opened) die('failed to open GitHub issue');
    if (opened.similar.length > 0) {
      process.stderr.write(`[harness] warning: similar open issues found — review before proceeding\n`);
    }
    out({ ...opened.handle, ecosystem: result.ecosystem, similar: opened.similar });
  } else {
    out({
      repo,
      ecosystem:   result.ecosystem,
      config:      result.config,
      regressions: [],
      next:        `inspect the project holistically — read the README, run it as a real user would, look for real-world correctness issues, missing value, usability problems, and reliability gaps, not just code quality. Form 2-4 recommendations spanning different dimensions (e.g. a correctness issue found by actually running the tool, a missing feature users would need, a usability gap, a code quality item). Ask the user which to pursue, then: harness open "<chosen goal>" --type <TYPE> --repo ${repo} --workdir ${result.config.workdir ?? path.resolve(workdir)}`,
    });
  }
  return 0;
}

export async function cmdOpen(args: Args): Promise<number> {
  const goal    = args.positional[0];
  const repo    = getRepo(flag(args, 'repo'));
  const workdir = flag(args, 'workdir') ? path.resolve(flag(args, 'workdir')!) : undefined;
  const asserts = flags(args, 'assert');
  const typeVal = flag(args, 'type') as IssueType | undefined;

  if (!goal) die('open requires a goal\n  Usage: harness open "<goal>" [--assert "cmd"]... [--type TYPE]');

  const assertions: Assertion[] = asserts.map((cmd) => ({
    type: 'shell' as const,
    command: cmd,
    expect: { exitCode: 0 },
  }));

  const config: HarnessConfig = { workdir, assertions, type: typeVal };

  // Run baseline — records current assertion state before any work begins.
  const baseline = assertions.length > 0 ? await check(config) : undefined;
  if (baseline?.ok) {
    process.stderr.write(`[harness] baseline: all assertions already pass — verify your goal isn't already complete\n`);
  }

  const opened = await openIssue(goal, config, repo, baseline);
  if (!opened) die('failed to open GitHub issue');

  if (opened.similar.length > 0) {
    process.stderr.write('[harness] warning: similar open issues exist:\n');
    for (const s of opened.similar) {
      process.stderr.write(`  #${s.number} "${s.goal}" (${Math.round(s.similarity * 100)}% overlap)\n`);
    }
    process.stderr.write('[harness] review before proceeding\n');
  }

  out({ ...opened.handle, similar: opened.similar.length > 0 ? opened.similar : undefined });
  return 0;
}

export async function cmdCheck(args: Args): Promise<number> {
  const issueNumber    = args.positional[0];
  const repo           = getRepo(flag(args, 'repo'));
  const workdirOverride = flag(args, 'workdir');

  if (!issueNumber) die('check requires an issue number\n  Usage: harness check <number>');

  const ctx = await getContext(repo, issueNumber);
  if (!ctx) die(`could not fetch issue #${issueNumber}`);
  if (ctx.config.assertions.length === 0) die(`issue #${issueNumber} has no assertions`);

  const result = await check(ctx.config, workdirOverride);
  process.stdout.write(formatCheckResult(result) + '\n');
  out(result);
  return result.ok ? 0 : 1;
}

export async function cmdLog(args: Args): Promise<number> {
  const issueNumber = args.positional[0];
  const message     = args.positional[1];
  const repo        = getRepo(flag(args, 'repo'));
  const outcome     = flag(args, 'outcome');   // pass | fail | blocked
  const duration    = flag(args, 'duration');  // seconds (number as string)
  const filesFlag   = flag(args, 'files');     // comma-separated file list

  if (!issueNumber || !message) die('log requires issue number and message\n  Usage: harness log <number> "<message>" [--outcome pass|fail|blocked] [--duration <s>] [--files a,b,c]');

  // Build structured header when metadata is provided
  const parts: string[] = [];
  if (outcome) {
    const icon = outcome === 'pass' ? '✅' : outcome === 'fail' ? '❌' : '⏸️';
    parts.push(`outcome: ${icon} ${outcome}`);
  }
  if (duration) {
    const secs = Number(duration);
    const label = secs >= 60 ? `${(secs / 60).toFixed(1)}m` : `${secs}s`;
    parts.push(`duration: ${label}`);
  }
  if (filesFlag) {
    parts.push(`files: ${filesFlag}`);
  }

  const body = parts.length > 0
    ? `**Attempt** | ${parts.join(' | ')}\n\n${message}`
    : message;

  await addComment(repo, issueNumber, body);
  return 0;
}

export async function cmdDone(args: Args): Promise<number> {
  const issueNumber = args.positional[0];
  const attempts    = Number(args.positional[1] ?? '1');
  const repo        = getRepo(flag(args, 'repo'));

  if (!issueNumber) die('done requires an issue number\n  Usage: harness done <number> [attempts]');

  // Read issue config to extract assertions + workdir for regression manifest.
  const ctx = await getContext(repo, issueNumber);
  if (ctx?.config.assertions.length && ctx.config.workdir) {
    const manifest = readRegressionManifest(ctx.config.workdir);
    // Replace existing entry for this issue if present, otherwise append.
    const filtered = manifest.filter((e) => e.issue !== issueNumber);
    filtered.push({
      issue:      issueNumber,
      goal:       ctx.goal,
      closedAt:   new Date().toISOString(),
      assertions: ctx.config.assertions,
    });
    writeRegressionManifest(ctx.config.workdir, filtered);
    process.stderr.write(`[harness] regression manifest updated (${filtered.length} issue(s))\n`);
  }

  await closeAsSucceeded(repo, issueNumber, attempts);
  process.stdout.write(`[harness] Issue #${issueNumber} closed as succeeded.\n`);
  return 0;
}

export async function cmdFail(args: Args): Promise<number> {
  const issueNumber = args.positional[0];
  const attempts    = Number(args.positional[1] ?? '1');
  const repo        = getRepo(flag(args, 'repo'));

  if (!issueNumber) die('fail requires an issue number\n  Usage: harness fail <number> [attempts]');

  await markAsFailed(repo, issueNumber, attempts);
  process.stdout.write(`[harness] Issue #${issueNumber} marked as failed.\n`);
  return 0;
}

export async function cmdContext(args: Args): Promise<number> {
  const issueNumber = args.positional[0];
  const repo        = getRepo(flag(args, 'repo'));

  if (!issueNumber) die('context requires an issue number\n  Usage: harness context <number>');

  const ctx = await getContext(repo, issueNumber);
  if (!ctx) die(`could not fetch issue #${issueNumber}`);

  out(ctx);
  return 0;
}

export async function cmdObserve(args: Args): Promise<number> {
  const observation = args.positional[0];
  const repo        = getRepo(flag(args, 'repo'));

  if (!observation) die('observe requires an observation\n  Usage: harness observe "<observation>"');

  const handle = await observeIssue(observation, repo);
  if (!handle) die('failed to create observation issue');

  out(handle);
  return 0;
}

export async function cmdHistory(args: Args): Promise<number> {
  const repo   = getRepo(flag(args, 'repo'));
  const issues = await listIssues(repo);

  if (issues.length === 0) {
    process.stdout.write('No harness issues found.\n');
  } else {
    for (const i of issues) {
      const icon =
        i.status === 'succeeded' ? '✅' :
        i.status === 'failed'    ? '❌' :
        i.status === 'triage'    ? '🔍' :
        i.status === 'spike'     ? '🧪' : '🔄';
      process.stdout.write(`${icon} #${i.number.padEnd(4)} ${i.goal.slice(0, 60).padEnd(62)} ${i.updatedAt.slice(0, 10)}\n`);
    }
    process.stdout.write(`\n${issues.length} issue(s)\n`);
  }
  out(issues);
  return 0;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

installSkill();

const [,, command, ...rest] = process.argv;
const args = parseArgs(rest);

const COMMANDS: Record<string, (a: Args) => Promise<number>> = {
  scan:    cmdScan,
  open:    cmdOpen,
  check:   cmdCheck,
  log:     cmdLog,
  done:    cmdDone,
  fail:    cmdFail,
  observe: cmdObserve,
  context: cmdContext,
  history: cmdHistory,
};

if (!command || command === 'help' || command === '--help' || command === '-h') {
  process.stdout.write(helpText());
  process.exit(0);
}

const handler = COMMANDS[command];
if (!handler) {
  process.stderr.write(`harness: unknown command "${command}"\n`);
  process.stderr.write('Run "harness help" for usage.\n');
  process.exit(1);
}

process.exit(await handler(args));
