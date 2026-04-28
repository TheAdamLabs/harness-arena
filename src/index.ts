#!/usr/bin/env node
/**
 * harness — self-correcting task executor for AI coding agents.
 *
 * Usage:
 *   harness run <task.json>     Execute a task with retries and GitHub observability
 *   harness validate <task.json> Check task JSON is well-formed without running it
 *   harness help                Show this help
 */

import fs from 'fs';
import path from 'path';
import { run } from './runner.js';
import type { Task } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg: string): never {
  process.stderr.write(`harness: ${msg}\n`);
  // eslint-disable-next-line no-process-exit
  process.exit(1) as never;
  throw new Error('unreachable');
}

function readTask(filePath: string): Task {
  const resolved = path.resolve(filePath);
  let raw: string;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch {
    die(`cannot read file: ${resolved}`);
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
  if (!Array.isArray(t['steps'])) die('task.steps must be an array');

  return t as unknown as Task;
}

function validateTask(task: Task, filePath: string): void {
  const errors: string[] = [];

  for (let i = 0; i < task.steps.length; i++) {
    const s = task.steps[i]!;
    if (s.type !== 'shell' && s.type !== 'file') {
      errors.push(`step ${i + 1}: unknown type "${(s as { type: string }).type}" (must be "shell" or "file")`);
    }
    if (s.type === 'shell' && !s.command) {
      errors.push(`step ${i + 1}: shell step missing "command"`);
    }
    if (s.type === 'file' && !s.path) {
      errors.push(`step ${i + 1}: file step missing "path"`);
    }
  }

  for (let i = 0; i < (task.assertions ?? []).length; i++) {
    const a = (task.assertions ?? [])[i]!;
    if (a.type !== 'shell' && a.type !== 'file') {
      errors.push(`assertion ${i + 1}: unknown type "${(a as { type: string }).type}"`);
    }
  }

  if (errors.length > 0) {
    process.stderr.write(`harness: validation errors in ${filePath}:\n`);
    for (const e of errors) process.stderr.write(`  • ${e}\n`);
    process.exit(1);
  }

  process.stdout.write(`harness: ${filePath} is valid (${task.steps.length} steps, ${task.assertions?.length ?? 0} assertions)\n`);
}

function printHelp(): void {
  process.stdout.write(`
harness — self-correcting task executor for AI coding agents

USAGE
  harness run <task.json>        Execute a task
  harness validate <task.json>   Validate task without running
  harness help                   Show this help

TASK FORMAT (JSON)
  {
    "goal":       "string — human-readable goal (becomes GitHub issue title)",
    "repo":       "owner/repo — GitHub repo for issue observability (optional)",
    "workdir":    "/path — base directory for all steps (default: cwd)",
    "maxRetries": 3,
    "steps": [
      { "type": "shell", "command": "npm test", "timeout": 60000 },
      { "type": "file",  "action": "write", "path": "out.txt", "content": "..." }
    ],
    "assertions": [
      { "type": "shell", "command": "npm test", "expect": { "exitCode": 0 } },
      { "type": "file",  "path": "dist/index.js", "expect": { "exists": true } }
    ]
  }

STEP TYPES
  shell   Run any shell command. Captures stdout, stderr, exit code.
  file    write | append | delete a file.

ASSERTION EXPECTS (shell)
  exitCode      number   Process must exit with this code (default: 0)
  contains      string   stdout+stderr must include this string
  notContains   string   stdout+stderr must NOT include this string

ASSERTION EXPECTS (file)
  exists        boolean  File must/must not exist
  contains      string   File content must include this string
  notContains   string   File content must NOT include this string

ENVIRONMENT
  GITHUB_REPO   Fallback repo if task.repo is not set (owner/repo)

EXIT CODES
  0   Task succeeded
  1   Task failed or validation error
`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const [,, command, argument] = process.argv;

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command === 'validate') {
  if (!argument) die('validate requires a task file path');
  const task = readTask(argument);
  validateTask(task, argument);
  process.exit(0);
}

if (command === 'run') {
  if (!argument) die('run requires a task file path');
  const task = readTask(argument);

  // Allow GITHUB_REPO env as fallback repo
  if (!task.repo && process.env['GITHUB_REPO']) {
    task.repo = process.env['GITHUB_REPO'];
  }

  const result = await run(task);

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.ok ? 0 : 1);
}

die(`unknown command "${command}". Run "harness help" for usage.`);
