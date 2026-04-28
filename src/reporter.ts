/**
 * reporter.ts
 *
 * GitHub Issues observability via @octokit/rest.
 * All methods are fire-and-forget — errors are logged but never thrown,
 * so a bad token or network hiccup never crashes the calling agent.
 */

import { Octokit } from '@octokit/rest';
import type { Task, IssueHandle } from './types.js';

const LABELS = {
  running:   { name: 'harness:running',   color: '0075ca', description: 'Harness task in progress' },
  succeeded: { name: 'harness:succeeded', color: '0e8a16', description: 'Harness task succeeded' },
  failed:    { name: 'harness:failed',    color: 'd93f0b', description: 'Harness task failed' },
} as const;

function makeClient(): Octokit | null {
  const token = process.env['GITHUB_TOKEN'];
  if (!token) {
    process.stderr.write('[harness] GITHUB_TOKEN not set — GitHub reporting disabled\n');
    return null;
  }
  return new Octokit({ auth: token });
}

function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`invalid repo format "${repo}" — expected owner/repo`);
  return { owner, repo: name };
}

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    process.stderr.write(`[harness] GitHub API error (${label}): ${(err as Error).message}\n`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Label bootstrap — idempotent, called on open
// ---------------------------------------------------------------------------

async function ensureLabels(octokit: Octokit, owner: string, repo: string): Promise<void> {
  for (const l of Object.values(LABELS)) {
    await safe(`ensureLabel:${l.name}`, () =>
      octokit.issues.createLabel({ owner, repo, name: l.name, color: l.color, description: l.description })
        .catch(async (err: { status?: number }) => {
          if (err.status === 422) {
            // Label already exists — update description/color in case they changed.
            await octokit.issues.updateLabel({ owner, repo, name: l.name, color: l.color, description: l.description });
          } else {
            throw err;
          }
        })
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function openIssue(task: Task, repoSlug: string): Promise<IssueHandle | null> {
  const octokit = makeClient();
  if (!octokit) return null;

  const { owner, repo } = parseRepo(repoSlug);
  await ensureLabels(octokit, owner, repo);

  const body = [
    `**Goal:** ${task.goal}`,
    '',
    `**Assertions:** ${task.assertions?.length ?? 0}`,
    task.workdir ? `**Workdir:** \`${task.workdir}\`` : '',
    '',
    '<details><summary>Full task definition</summary>',
    '',
    '```json',
    JSON.stringify(task, null, 2),
    '```',
    '</details>',
  ].filter((l) => l !== null).join('\n');

  const result = await safe('openIssue', () =>
    octokit.issues.create({
      owner,
      repo,
      title: `[harness] ${task.goal}`,
      body,
      labels: [LABELS.running.name],
    })
  );

  if (!result) return null;
  return {
    number: String(result.data.number),
    url: result.data.html_url,
  };
}

export async function addComment(repoSlug: string, issueNumber: string, body: string): Promise<void> {
  const octokit = makeClient();
  if (!octokit) return;

  const { owner, repo } = parseRepo(repoSlug);
  await safe('addComment', () =>
    octokit.issues.createComment({
      owner,
      repo,
      issue_number: Number(issueNumber),
      body,
    })
  );
}

export async function closeAsSucceeded(repoSlug: string, issueNumber: string, attempts: number): Promise<void> {
  const octokit = makeClient();
  if (!octokit) return;

  const { owner, repo } = parseRepo(repoSlug);
  const num = Number(issueNumber);

  await safe('closeComment', () =>
    octokit.issues.createComment({
      owner, repo, issue_number: num,
      body: `**Result: ✅ succeeded** — completed in ${attempts} attempt(s).`,
    })
  );
  await safe('closeIssue', () =>
    octokit.issues.update({ owner, repo, issue_number: num, state: 'closed' })
  );
  await safe('swapLabel', () =>
    octokit.issues.setLabels({
      owner, repo, issue_number: num,
      labels: [LABELS.succeeded.name],
    })
  );
}

export async function markAsFailed(repoSlug: string, issueNumber: string, attempts: number): Promise<void> {
  const octokit = makeClient();
  if (!octokit) return;

  const { owner, repo } = parseRepo(repoSlug);
  const num = Number(issueNumber);

  await safe('failComment', () =>
    octokit.issues.createComment({
      owner, repo, issue_number: num,
      body: `**Result: ❌ failed** — exhausted ${attempts} attempt(s).`,
    })
  );
  await safe('failLabel', () =>
    octokit.issues.setLabels({
      owner, repo, issue_number: num,
      labels: [LABELS.failed.name],
    })
  );
}
