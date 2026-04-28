/**
 * reporter.ts
 *
 * GitHub Issues as the single source of truth via @octokit/rest.
 *
 * The HarnessConfig (workdir + assertions) is embedded in the issue body
 * as a hidden HTML comment so any agent on any machine can pick up a task
 * by issue number alone — no local file required.
 *
 * All methods are non-throwing — errors are logged, never propagated.
 */

import { Octokit } from '@octokit/rest';
import type {
  HarnessConfig,
  IssueHandle,
  IssueContext,
  IssueSummary,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LABELS = {
  running:   { name: 'harness:running',   color: '0075ca', description: 'Harness task in progress' },
  succeeded: { name: 'harness:succeeded', color: '0e8a16', description: 'Harness task succeeded' },
  failed:    { name: 'harness:failed',    color: 'd93f0b', description: 'Harness task exhausted all retries' },
} as const;

const CONFIG_OPEN  = '<!-- harness:config\n';
const CONFIG_CLOSE = '\n-->';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Octokit logs deprecation notices for endpoints that are scheduled for
// removal years in the future. These are noise for agent stderr output.
// Real errors still go through process.stderr via the `safe()` wrapper.
const silentLog = {
  debug: () => {},
  info:  () => {},
  warn:  () => {},
  error: () => {},
};

function makeClient(): Octokit | null {
  const token = process.env['GITHUB_TOKEN'];
  if (!token) {
    process.stderr.write('[harness] GITHUB_TOKEN not set — GitHub reporting disabled\n');
    return null;
  }
  return new Octokit({ auth: token, log: silentLog });
}

export function parseRepo(slug: string): { owner: string; repo: string } {
  const [owner, name] = slug.split('/');
  if (!owner || !name) throw new Error(`invalid repo "${slug}" — expected owner/repo`);
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

export function labelStatus(labels: Array<{ name?: string }>): IssueSummary['status'] {
  const names = labels.map((l) => l.name ?? '');
  if (names.includes('harness:succeeded')) return 'succeeded';
  if (names.includes('harness:failed'))    return 'failed';
  if (names.includes('harness:running'))   return 'running';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Config embedding — stored as a hidden HTML comment in the issue body
// ---------------------------------------------------------------------------

export function embedConfig(config: HarnessConfig): string {
  return CONFIG_OPEN + JSON.stringify(config) + CONFIG_CLOSE;
}

export function parseConfig(issueBody: string): HarnessConfig | null {
  const start = issueBody.indexOf(CONFIG_OPEN);
  const end   = issueBody.indexOf(CONFIG_CLOSE, start);
  if (start === -1 || end === -1) return null;

  const json = issueBody.slice(start + CONFIG_OPEN.length, end).trim();
  try {
    return JSON.parse(json) as HarnessConfig;
  } catch {
    return null;
  }
}

export function buildIssueBody(goal: string, config: HarnessConfig): string {
  const assertionCount = config.assertions.length;
  const lines = [
    `**Goal:** ${goal}`,
    '',
    `**Assertions:** ${assertionCount}${config.workdir ? ` | **Workdir:** \`${config.workdir}\`` : ''}`,
    '',
    embedConfig(config),
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Label bootstrap
// ---------------------------------------------------------------------------

async function ensureLabels(octokit: Octokit, owner: string, repo: string): Promise<void> {
  for (const l of Object.values(LABELS)) {
    await safe(`ensureLabel:${l.name}`, () =>
      octokit.issues.createLabel({ owner, repo, name: l.name, color: l.color, description: l.description })
        .catch(async (err: { status?: number }) => {
          if (err.status === 422) {
            await octokit.issues.updateLabel({ owner, repo, name: l.name, color: l.color, description: l.description });
          } else {
            throw err;
          }
        })
    );
  }
}

// ---------------------------------------------------------------------------
// Deduplication — return existing open issue if goal already tracked
// ---------------------------------------------------------------------------

async function findExisting(
  octokit: Octokit,
  owner: string,
  repo: string,
  goal: string,
): Promise<IssueHandle | null> {
  const title = `[harness] ${goal}`;
  const result = await safe('findExisting', () =>
    octokit.issues.listForRepo({
      owner, repo,
      state: 'open',
      labels: LABELS.running.name,
      per_page: 50,
    })
  );

  if (!result) return null;
  const match = result.data.find((i) => i.title === title);
  if (!match) return null;

  process.stderr.write(`[harness] duplicate: issue #${match.number} already tracks this goal\n`);
  return { number: String(match.number), url: match.html_url, goal };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function openIssue(
  goal: string,
  config: HarnessConfig,
  repoSlug: string,
): Promise<IssueHandle | null> {
  const octokit = makeClient();
  if (!octokit) return null;

  const { owner, repo } = parseRepo(repoSlug);

  await ensureLabels(octokit, owner, repo);

  const existing = await findExisting(octokit, owner, repo, goal);
  if (existing) return existing;

  const result = await safe('openIssue', () =>
    octokit.issues.create({
      owner, repo,
      title: `[harness] ${goal}`,
      body: buildIssueBody(goal, config),
      labels: [LABELS.running.name],
    })
  );

  if (!result) return null;
  return { number: String(result.data.number), url: result.data.html_url, goal };
}

export async function addComment(
  repoSlug: string,
  issueNumber: string,
  body: string,
): Promise<void> {
  const octokit = makeClient();
  if (!octokit) return;

  const { owner, repo } = parseRepo(repoSlug);
  await safe('addComment', () =>
    octokit.issues.createComment({
      owner, repo,
      issue_number: Number(issueNumber),
      body,
    })
  );
}

export async function closeAsSucceeded(
  repoSlug: string,
  issueNumber: string,
  attempts: number,
): Promise<void> {
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
    octokit.issues.setLabels({ owner, repo, issue_number: num, labels: [LABELS.succeeded.name] })
  );
}

export async function markAsFailed(
  repoSlug: string,
  issueNumber: string,
  attempts: number,
): Promise<void> {
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
    octokit.issues.setLabels({ owner, repo, issue_number: num, labels: [LABELS.failed.name] })
  );
}

export async function getContext(
  repoSlug: string,
  issueNumber: string,
): Promise<IssueContext | null> {
  const octokit = makeClient();
  if (!octokit) return null;

  const { owner, repo } = parseRepo(repoSlug);
  const num = Number(issueNumber);

  const [issueRes, commentsRes] = await Promise.all([
    safe('getIssue', () => octokit.issues.get({ owner, repo, issue_number: num })),
    safe('getComments', () => octokit.issues.listComments({ owner, repo, issue_number: num, per_page: 100 })),
  ]);

  if (!issueRes) return null;

  const issue = issueRes.data;
  const body = issue.body ?? '';
  const config = parseConfig(body) ?? { assertions: [] };
  const goal = issue.title.replace(/^\[harness\]\s*/, '');

  return {
    number: issueNumber,
    url: issue.html_url,
    goal,
    status: labelStatus(issue.labels as Array<{ name?: string }>),
    config,
    attempts: (commentsRes?.data ?? []).map((c) => ({
      id: c.id,
      body: c.body ?? '',
      createdAt: c.created_at,
    })),
  };
}

export async function listIssues(repoSlug: string): Promise<IssueSummary[]> {
  const octokit = makeClient();
  if (!octokit) return [];

  const { owner, repo } = parseRepo(repoSlug);

  const result = await safe('listIssues', () =>
    octokit.issues.listForRepo({
      owner, repo,
      state: 'all',
      labels: 'harness:running,harness:succeeded,harness:failed',
      per_page: 50,
      sort: 'updated',
    })
  );

  if (!result) return [];

  return result.data
    .filter((i) => i.title.startsWith('[harness]'))
    .map((i) => ({
      number: String(i.number),
      url: i.html_url,
      goal: i.title.replace(/^\[harness\]\s*/, ''),
      status: labelStatus(i.labels as Array<{ name?: string }>),
      updatedAt: i.updated_at,
    }));
}
