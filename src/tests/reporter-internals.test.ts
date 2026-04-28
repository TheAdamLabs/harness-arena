import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safe, ensureLabels, findExisting } from '../reporter.js';
import type { Octokit } from '@octokit/rest';

// ---------------------------------------------------------------------------
// Minimal Octokit mock helpers
// ---------------------------------------------------------------------------

type Call = { method: string; args: unknown };

function makeOctokit(overrides: Record<string, unknown> = {}): { octokit: Octokit; calls: Call[] } {
  const calls: Call[] = [];

  const issues = {
    createLabel: async (...args: unknown[]) => { calls.push({ method: 'createLabel', args }); return { data: {} }; },
    updateLabel: async (...args: unknown[]) => { calls.push({ method: 'updateLabel', args }); return { data: {} }; },
    listForRepo:  async (...args: unknown[]) => { calls.push({ method: 'listForRepo', args });  return { data: [] }; },
    ...overrides,
  };

  return { octokit: { issues } as unknown as Octokit, calls };
}

// ---------------------------------------------------------------------------
// safe()
// ---------------------------------------------------------------------------

describe('safe()', () => {
  it('returns the result when fn resolves', async () => {
    const result = await safe('test', async () => 42);
    assert.equal(result, 42);
  });

  it('returns null when fn throws', async () => {
    const result = await safe('test', async () => { throw new Error('boom'); });
    assert.equal(result, null);
  });

  it('writes to stderr with label when fn throws', async () => {
    const lines: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s: string) => { lines.push(s); return true; };

    await safe('my-label', async () => { throw new Error('network error'); });

    process.stderr.write = orig;
    assert.ok(lines.some((l) => l.includes('my-label')), 'should include label in output');
    assert.ok(lines.some((l) => l.includes('network error')), 'should include error message');
  });

  it('returns null on rejected promise (non-Error throw)', async () => {
    const result = await safe('test', async () => { throw 'string error'; });
    assert.equal(result, null);
  });

  it('propagates the resolved value unchanged for objects', async () => {
    const obj = { data: [1, 2, 3] };
    const result = await safe('test', async () => obj);
    assert.deepEqual(result, obj);
  });
});

// ---------------------------------------------------------------------------
// ensureLabels()
// ---------------------------------------------------------------------------

describe('ensureLabels()', () => {
  it('calls createLabel for each of the 3 harness labels', async () => {
    const { octokit, calls } = makeOctokit();
    await ensureLabels(octokit, 'owner', 'repo');
    const creates = calls.filter((c) => c.method === 'createLabel');
    assert.equal(creates.length, 3, 'should create 3 labels');
  });

  it('calls updateLabel when createLabel returns 422', async () => {
    const { octokit, calls } = makeOctokit({
      createLabel: async (...args: unknown[]) => {
        calls.push({ method: 'createLabel', args });
        throw Object.assign(new Error('already exists'), { status: 422 });
      },
    });
    await ensureLabels(octokit, 'owner', 'repo');
    const updates = calls.filter((c) => c.method === 'updateLabel');
    assert.equal(updates.length, 3, 'should update all 3 labels that already exist');
  });

  it('passes owner and repo to createLabel', async () => {
    const { octokit, calls } = makeOctokit();
    await ensureLabels(octokit, 'myowner', 'myrepo');
    const first = calls.find((c) => c.method === 'createLabel');
    const arg = (first?.args as [Record<string, unknown>])[0];
    assert.equal(arg?.['owner'], 'myowner');
    assert.equal(arg?.['repo'], 'myrepo');
  });
});

// ---------------------------------------------------------------------------
// findExisting()
// ---------------------------------------------------------------------------

describe('findExisting()', () => {
  it('returns null when no matching issue found', async () => {
    const { octokit } = makeOctokit();
    const result = await findExisting(octokit, 'owner', 'repo', 'My goal');
    assert.equal(result, null);
  });

  it('returns issue handle when title matches', async () => {
    const { octokit } = makeOctokit({
      listForRepo: async () => ({
        data: [
          { number: 42, title: '[harness] My goal', html_url: 'https://github.com/owner/repo/issues/42' },
        ],
      }),
    });
    const result = await findExisting(octokit, 'owner', 'repo', 'My goal');
    assert.deepEqual(result, {
      number: '42',
      url: 'https://github.com/owner/repo/issues/42',
      goal: 'My goal',
    });
  });

  it('returns null when title does not match exactly', async () => {
    const { octokit } = makeOctokit({
      listForRepo: async () => ({
        data: [
          { number: 5, title: '[harness] Different goal', html_url: 'https://github.com/owner/repo/issues/5' },
        ],
      }),
    });
    const result = await findExisting(octokit, 'owner', 'repo', 'My goal');
    assert.equal(result, null);
  });

  it('returns null when listForRepo fails', async () => {
    const { octokit } = makeOctokit({
      listForRepo: async () => { throw new Error('API error'); },
    });
    const result = await findExisting(octokit, 'owner', 'repo', 'My goal');
    assert.equal(result, null);
  });
});
