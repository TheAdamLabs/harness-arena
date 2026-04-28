#!/usr/bin/env node
/**
 * harness — self-correcting loop coordinator for AI coding agents.
 *
 * The AI agent authors tasks and does the actual work.
 * harness handles GitHub Issues observability and assertion verification.
 *
 * Commands:
 *   harness open   <task.json>                    Open a tracking GitHub Issue
 *   harness check  <task.json>                    Run assertions, print PASS/FAIL
 *   harness log    <issue-number> <message>       Add a comment to the issue
 *   harness done   <issue-number> <attempts>      Close issue as succeeded
 *   harness fail   <issue-number> <attempts>      Mark issue as failed (leave open)
 *   harness help                                  Show this help
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { check, formatCheckResult } from './checker.js';
import { openIssue, addComment, closeAsSucceeded, markAsFailed } from './reporter.js';
import type { Task } from './types.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SKILL_SRC  = path.resolve(__dir, '../SKILL.md');
const SKILL_DEST = path.join(os.homedir(), '.cursor', 'skills', 'harness-arena', 'SKILL.md');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg: string): never {
  process.stderr.write(`harness: ${msg}\n`);
  process.exit(1) as never;
  throw new Error('unreachable');
}

function out(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function readTask(filePath: string): Task {
  const resolved = path.resolve(filePath);
  let raw: string;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch {
    die(`cannot read task file: ${resolved}`);
  }

  let task: unknown;
  try {
    task = JSON.parse(raw);
  } catch {
    die(`invalid JSON in ${resolved}`);
  }

  if (typeof task !== 'object' || task === null) die('task must be a JSON object');
  const t = task as Record<string, unknown>;
  if (typeof t['goal'] !== 'string' || !t['goal']) die('task.goal must be a non-empty string');

  return t as unknown as Task;
}

function getRepo(task: Task): string | undefined {
  return task.repo ?? process.env['GITHUB_REPO'];
}

function installSkill(): void {
  try {
    if (!fs.existsSync(SKILL_SRC)) return;
    fs.mkdirSync(path.dirname(SKILL_DEST), { recursive: true });
    fs.copyFileSync(SKILL_SRC, SKILL_DEST);
  } catch { /* non-fatal */ }
}

function printHelp(): void {
  process.stdout.write(`
harness — self-correcting loop coordinator for AI coding agents

The AI agent does the work. harness tracks it on GitHub and verifies success.

COMMANDS

  harness open <task.json>
    Open a GitHub Issue for this task. Prints { number, url }.
    Sets label harness:running. Creates labels if missing.

  harness check <task.json>
    Run all assertions in the task. Prints pass/fail per assertion.
    Exit code 0 = all pass, 1 = at least one fails.

  harness log <issue-number> <message>
    Add a comment to the tracking issue (progress, errors, attempts).

  harness done <issue-number> <attempts>
    Close the issue as succeeded. Swaps label to harness:succeeded.

  harness fail <issue-number> <attempts>
    Mark the issue as failed (leave open). Swaps label to harness:failed.

  harness help
    Show this help.

TASK FORMAT

  {
    "goal":       "Fix all TypeScript type errors in src/",
    "repo":       "owner/repo",
    "workdir":    "/path/to/repo",
    "assertions": [
      { "type": "shell", "command": "npx tsc --noEmit", "expect": { "exitCode": 0 } },
      { "type": "shell", "command": "npm test",         "expect": { "exitCode": 0 } },
      { "type": "file",  "path": "dist/index.js",       "expect": { "exists": true } }
    ]
  }

ASSERTION TYPES

  shell  { command, cwd?, expect: { exitCode?, contains?, notContains? } }
  file   { path, expect: { exists?, contains?, notContains? } }

ENVIRONMENT

  GITHUB_TOKEN   Required for GitHub API access
  GITHUB_REPO    Fallback repo (owner/repo) if task.repo is not set

LOOP PATTERN (for AI agents — see SKILL.md for full guide)

  1. Write task.json with goal + assertions
  2. harness open task.json          → { number, url }
  3. Do the actual work (edit files, run commands, etc.)
  4. harness check task.json         → PASS or FAIL
  5. harness log <number> "<notes>"
  6. If PASS:  harness done <number> <attempt>
     If FAIL and retries left: go to step 3
     If FAIL and out of retries: harness fail <number> <attempt>
`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

installSkill();

const [,, command, arg1, arg2] = process.argv;

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

// --- open -------------------------------------------------------------------
if (command === 'open') {
  if (!arg1) die('open requires a task file path\n  Usage: harness open <task.json>');
  const task = readTask(arg1);
  const repo = getRepo(task);

  if (!repo) {
    die('no repo specified — set task.repo or GITHUB_REPO env var');
  }

  const handle = await openIssue(task, repo);
  if (!handle) die('failed to open GitHub issue (check GITHUB_TOKEN and repo access)');

  out(handle);
  process.exit(0);
}

// --- check ------------------------------------------------------------------
if (command === 'check') {
  if (!arg1) die('check requires a task file path\n  Usage: harness check <task.json>');
  const task = readTask(arg1);
  const result = await check(task);

  process.stdout.write(formatCheckResult(result) + '\n');
  out(result);
  process.exit(result.ok ? 0 : 1);
}

// --- log --------------------------------------------------------------------
if (command === 'log') {
  if (!arg1 || !arg2) die('log requires issue number and message\n  Usage: harness log <number> "<message>"');
  const task_repo = process.env['GITHUB_REPO'];
  if (!task_repo) die('GITHUB_REPO env var required for log command');

  await addComment(task_repo, arg1, arg2);
  process.exit(0);
}

// --- done -------------------------------------------------------------------
if (command === 'done') {
  if (!arg1) die('done requires an issue number\n  Usage: harness done <number> [attempts]');
  const repo = process.env['GITHUB_REPO'];
  if (!repo) die('GITHUB_REPO env var required for done command');

  const attempts = arg2 ? Number(arg2) : 1;
  await closeAsSucceeded(repo, arg1, attempts);
  process.stdout.write(`[harness] Issue #${arg1} closed as succeeded.\n`);
  process.exit(0);
}

// --- fail -------------------------------------------------------------------
if (command === 'fail') {
  if (!arg1) die('fail requires an issue number\n  Usage: harness fail <number> [attempts]');
  const repo = process.env['GITHUB_REPO'];
  if (!repo) die('GITHUB_REPO env var required for fail command');

  const attempts = arg2 ? Number(arg2) : 1;
  await markAsFailed(repo, arg1, attempts);
  process.stdout.write(`[harness] Issue #${arg1} marked as failed.\n`);
  process.exit(0);
}

die(`unknown command "${command}". Run "harness help" for usage.`);
