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
  CheckResult,
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
  triage:    { name: 'harness:triage',    color: 'e4e669', description: 'Observed issue pending triage' },
  spike:     { name: 'harness:spike',     color: '5319e7', description: 'Exploratory spike — produces observations' },
  live:      { name: 'harness:live',      color: 'f9d0c4', description: 'Assertions require a running live environment' },
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

export async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
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
  if (names.includes('harness:triage'))    return 'triage';
  if (names.includes('harness:spike'))     return 'spike';
  if (names.includes('harness:live'))      return 'running'; // live issues are active work
  return 'unknown';
}

// Jaccard word-overlap similarity for fuzzy duplicate detection.
// Returns 0 (no overlap) to 1 (identical word sets).
export function titleSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
  const wa = words(a);
  const wb = words(b);
  const intersection = [...wa].filter((x) => wb.has(x)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : intersection / union;
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

export function buildIssueBody(
  goal: string,
  config: HarnessConfig,
  baseline?: CheckResult,
): string {
  const assertionCount = config.assertions.length;
  const typeTag = config.type ? ` | **Type:** \`${config.type}\`` : '';
  const lines = [
    `**Goal:** ${goal}`,
    '',
    `**Assertions:** ${assertionCount}${config.workdir ? ` | **Workdir:** \`${config.workdir}\`` : ''}${typeTag}`,
  ];

  if (baseline) {
    const passed = baseline.results.filter((r) => r.ok).length;
    const icon = baseline.ok ? '✅' : '⚠️';
    lines.push('');
    lines.push(`**Baseline at open:** ${icon} ${passed}/${assertionCount} assertions pass`);
    if (!baseline.ok) {
      for (const r of baseline.results.filter((r) => !r.ok)) {
        const label = r.assertion.type === 'shell'
          ? (r.assertion as { command: string }).command.slice(0, 60)
          : (r.assertion as { path: string }).path;
        lines.push(`  - ❌ \`${label}\`: ${r.reason ?? 'failed'}`);
      }
    }
  }

  lines.push('');
  lines.push(embedConfig(config));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Label bootstrap
// ---------------------------------------------------------------------------

export async function ensureLabels(octokit: Octokit, owner: string, repo: string): Promise<void> {
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

export async function findExisting(
  octokit: Octokit,
  owner: string,
  repo: string,
  goal: string,
): Promise<{ exact: IssueHandle | null; similar: Array<{ number: string; goal: string; similarity: number }> }> {
  const title = `[harness] ${goal}`;
  const result = await safe('findExisting', () =>
    octokit.issues.listForRepo({
      owner, repo,
      state: 'open',
      labels: LABELS.running.name,
      per_page: 50,
    })
  );

  if (!result) return { exact: null, similar: [] };

  const exact = result.data.find((i) => i.title === title);
  if (exact) {
    process.stderr.write(`[harness] duplicate: issue #${exact.number} already tracks this goal\n`);
    return { exact: { number: String(exact.number), url: exact.html_url, goal }, similar: [] };
  }

  // Fuzzy: find open issues with >50% word overlap — warn but don't block.
  const similar = result.data
    .map((i) => ({
      number: String(i.number),
      goal: i.title.replace(/^\[harness\]\s*/, ''),
      similarity: titleSimilarity(goal, i.title.replace(/^\[harness\]\s*/, '')),
    }))
    .filter((i) => i.similarity >= 0.5)
    .sort((a, b) => b.similarity - a.similarity);

  return { exact: null, similar };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function openIssue(
  goal: string,
  config: HarnessConfig,
  repoSlug: string,
  baseline?: CheckResult,
): Promise<{ handle: IssueHandle; similar: Array<{ number: string; goal: string; similarity: number }> } | null> {
  const octokit = makeClient();
  if (!octokit) return null;

  const { owner, repo } = parseRepo(repoSlug);

  await ensureLabels(octokit, owner, repo);

  const { exact, similar } = await findExisting(octokit, owner, repo, goal);
  if (exact) return { handle: exact, similar: [] };

  const labelName = config.type === 'spike' ? LABELS.spike.name
    : config.type === 'live' ? LABELS.live.name
    : LABELS.running.name;

  const result = await safe('openIssue', () =>
    octokit.issues.create({
      owner, repo,
      title: `[harness] ${goal}`,
      body: buildIssueBody(goal, config, baseline),
      labels: [labelName],
    })
  );

  if (!result) return null;
  return {
    handle: { number: String(result.data.number), url: result.data.html_url, goal },
    similar,
  };
}

/** Create a triage observation issue — no assertions, no config, just a note. */
export async function observeIssue(
  observation: string,
  repoSlug: string,
): Promise<IssueHandle | null> {
  const octokit = makeClient();
  if (!octokit) return null;

  const { owner, repo } = parseRepo(repoSlug);
  await ensureLabels(octokit, owner, repo);

  const result = await safe('observeIssue', () =>
    octokit.issues.create({
      owner, repo,
      title: `[harness:observe] ${observation}`,
      body: `**Observation logged during workflow run.**\n\nThis is a triage draft — no assertions attached. Promote to a fix/correctness/spike issue when ready to act on it.`,
      labels: [LABELS.triage.name],
    })
  );

  if (!result) return null;
  return { number: String(result.data.number), url: result.data.html_url, goal: observation };
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
      per_page: 100,
      sort: 'updated',
    })
  );

  if (!result) return [];

  return result.data
    .filter((i) => i.title.startsWith('[harness]') || i.title.startsWith('[harness:observe]'))
    .map((i) => ({
      number: String(i.number),
      url: i.html_url,
      goal: i.title.replace(/^\[harness(?::\w+)?\]\s*/, ''),
      status: labelStatus(i.labels as Array<{ name?: string }>),
      updatedAt: i.updated_at,
    }));
}
