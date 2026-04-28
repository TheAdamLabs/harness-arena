/**
 * reporter.ts
 *
 * GitHub Issues observability via the `gh` CLI.
 * Every call is fire-and-forget — failures are logged but never thrown,
 * so a broken gh auth never crashes the harness.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Task, AttemptResult, StepResult } from './types.js';

const execFileAsync = promisify(execFile);

async function gh(repo: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gh', ['--repo', repo, ...args]);
    return stdout.trim();
  } catch (err) {
    process.stderr.write(`[reporter] gh ${args[0] ?? ''} failed: ${(err as Error).message}\n`);
    return null;
  }
}

function issueUrl(repo: string, number: string): string {
  return `https://github.com/${repo}/issues/${number}`;
}

function extractNumber(output: string | null): string | null {
  const m = output?.match(/\/(\d+)$/);
  return m ? (m[1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function stepLabel(r: StepResult): string {
  if (r.step.type === 'shell') {
    return `\`${r.step.command.slice(0, 80)}\``;
  }
  return `\`file:${r.step.action} ${r.step.path}\``;
}

function formatStepBlock(r: StepResult): string {
  const lines: string[] = [];
  const icon = r.ok ? '✅' : '❌';
  lines.push(`${icon} **Step ${r.index + 1}:** ${stepLabel(r)} — ${r.durationMs}ms`);

  if (!r.ok) {
    if (r.stderr) lines.push('```\n' + r.stderr.slice(0, 1000) + '\n```');
    if (r.error)  lines.push(`> ${r.error.slice(0, 300)}`);
  }
  return lines.join('\n');
}

function formatAttemptComment(result: AttemptResult, task: Task): string {
  const lines: string[] = [
    `### Attempt ${result.attempt}/${task.maxRetries ?? 3}`,
    '',
    '**Steps:**',
    ...result.stepResults.map(formatStepBlock),
  ];

  if (result.assertionResults.length > 0) {
    lines.push('', '**Assertions:**');
    for (const a of result.assertionResults) {
      const icon = a.ok ? '✅' : '❌';
      const label = a.assertion.type === 'shell'
        ? `\`${a.assertion.command.slice(0, 80)}\``
        : `file \`${a.assertion.path}\``;
      lines.push(`${icon} ${label}${a.reason ? ` — ${a.reason}` : ''}`);
    }
  }

  if (result.error) {
    lines.push('', `**Aborted:** \`${result.error.slice(0, 300)}\``);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface IssueHandle {
  number: string;
  url: string;
}

export async function openIssue(task: Task, repo: string): Promise<IssueHandle | null> {
  const body = [
    `**Goal:** ${task.goal}`,
    '',
    `**Steps:** ${task.steps.length} | **Assertions:** ${task.assertions?.length ?? 0} | **Max retries:** ${task.maxRetries ?? 3}`,
    '',
    '<details><summary>Full task definition</summary>',
    '',
    '```json',
    JSON.stringify(task, null, 2),
    '```',
    '',
    '</details>',
  ].join('\n');

  const out = await gh(
    repo,
    'issue', 'create',
    '--title', `[harness] ${task.goal}`,
    '--body', body,
    '--label', 'harness:running',
  );

  const number = extractNumber(out);
  if (!number) return null;
  return { number, url: issueUrl(repo, number) };
}

export async function commentAttempt(
  handle: IssueHandle,
  repo: string,
  result: AttemptResult,
  task: Task,
): Promise<void> {
  await gh(repo, 'issue', 'comment', handle.number, '--body', formatAttemptComment(result, task));
}

export async function closeSuccess(handle: IssueHandle, repo: string, attempts: number): Promise<void> {
  const body = `**Result: ✅ success** — completed in ${attempts} attempt(s).`;
  await gh(repo, 'issue', 'comment', handle.number, '--body', body);
  await gh(repo, 'issue', 'close', handle.number, '--comment', '');
  await gh(repo, 'issue', 'edit', handle.number,
    '--remove-label', 'harness:running',
    '--add-label', 'harness:succeeded',
  );
}

export async function markFailed(handle: IssueHandle, repo: string, maxRetries: number): Promise<void> {
  const body = `**Result: ❌ failed** — exhausted ${maxRetries} attempt(s).`;
  await gh(repo, 'issue', 'comment', handle.number, '--body', body);
  await gh(repo, 'issue', 'edit', handle.number,
    '--remove-label', 'harness:running',
    '--add-label', 'harness:failed',
  );
}

export async function ensureLabels(repo: string): Promise<void> {
  const labels = [
    { name: 'harness:running',   color: '0075ca', desc: 'Harness task in progress' },
    { name: 'harness:succeeded', color: '0e8a16', desc: 'Harness task completed successfully' },
    { name: 'harness:failed',    color: 'd93f0b', desc: 'Harness task exhausted all retries' },
  ];

  for (const l of labels) {
    await gh(repo,
      'label', 'create', l.name,
      '--color', l.color,
      '--description', l.desc,
      '--force',
    );
  }
}
