import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  embedConfig, parseConfig,
  parseRepo, labelStatus, buildIssueBody,
} from '../reporter.js';
import type { HarnessConfig } from '../types.js';

const FIXTURE: HarnessConfig = {
  workdir: '/tmp/test-repo',
  assertions: [
    { type: 'shell', command: 'npx tsc --noEmit', expect: { exitCode: 0 } },
    { type: 'file',  path: 'dist/index.js',       expect: { exists: true } },
  ],
};

// ---------------------------------------------------------------------------
// embedConfig / parseConfig
// ---------------------------------------------------------------------------

describe('reporter — config embedding', () => {
  it('round-trips config through embed → parse', () => {
    const body = `**Goal:** test\n\n${embedConfig(FIXTURE)}`;
    const parsed = parseConfig(body);
    assert.deepEqual(parsed, FIXTURE);
  });

  it('parseConfig returns null when no config comment present', () => {
    assert.equal(parseConfig('no config here'), null);
  });

  it('parseConfig returns null on malformed JSON', () => {
    const broken = '<!-- harness:config\nnot valid json\n-->';
    assert.equal(parseConfig(broken), null);
  });

  it('embedConfig produces hidden HTML comment', () => {
    const embedded = embedConfig(FIXTURE);
    assert.ok(embedded.startsWith('<!-- harness:config'), 'should start with HTML comment');
    assert.ok(embedded.endsWith('-->'), 'should end with HTML comment');
  });

  it('parseConfig handles config without workdir', () => {
    const minimal: HarnessConfig = { assertions: [] };
    const body = embedConfig(minimal);
    assert.deepEqual(parseConfig(body), minimal);
  });
});

// ---------------------------------------------------------------------------
// parseRepo
// ---------------------------------------------------------------------------

describe('parseRepo', () => {
  it('splits owner/repo slug correctly', () => {
    assert.deepEqual(parseRepo('theadamlabs/harness-arena'), {
      owner: 'theadamlabs',
      repo:  'harness-arena',
    });
  });

  it('works with single-word org names', () => {
    assert.deepEqual(parseRepo('octocat/hello-world'), {
      owner: 'octocat',
      repo:  'hello-world',
    });
  });

  it('throws on missing slash', () => {
    assert.throws(() => parseRepo('noslash'), /expected owner\/repo/);
  });

  it('throws on empty string', () => {
    assert.throws(() => parseRepo(''), /expected owner\/repo/);
  });

  it('throws when owner is missing', () => {
    assert.throws(() => parseRepo('/repo-only'), /expected owner\/repo/);
  });
});

// ---------------------------------------------------------------------------
// labelStatus
// ---------------------------------------------------------------------------

describe('labelStatus', () => {
  it('returns "running" for harness:running label', () => {
    assert.equal(labelStatus([{ name: 'harness:running' }]), 'running');
  });

  it('returns "succeeded" for harness:succeeded label', () => {
    assert.equal(labelStatus([{ name: 'harness:succeeded' }]), 'succeeded');
  });

  it('returns "failed" for harness:failed label', () => {
    assert.equal(labelStatus([{ name: 'harness:failed' }]), 'failed');
  });

  it('returns "unknown" when no harness labels present', () => {
    assert.equal(labelStatus([{ name: 'bug' }, { name: 'enhancement' }]), 'unknown');
  });

  it('returns "unknown" for empty label list', () => {
    assert.equal(labelStatus([]), 'unknown');
  });

  it('handles labels with undefined name', () => {
    assert.equal(labelStatus([{}, { name: 'harness:running' }]), 'running');
  });

  it('prefers succeeded over running when both present', () => {
    assert.equal(labelStatus([{ name: 'harness:running' }, { name: 'harness:succeeded' }]), 'succeeded');
  });
});

// ---------------------------------------------------------------------------
// buildIssueBody
// ---------------------------------------------------------------------------

describe('buildIssueBody', () => {
  it('includes the goal in the body', () => {
    const body = buildIssueBody('Fix all TypeScript errors', FIXTURE);
    assert.ok(body.includes('Fix all TypeScript errors'));
  });

  it('includes the assertion count', () => {
    const body = buildIssueBody('my goal', FIXTURE);
    assert.ok(body.includes('2'), 'should mention assertion count');
  });

  it('includes the workdir when set', () => {
    const body = buildIssueBody('my goal', FIXTURE);
    assert.ok(body.includes('/tmp/test-repo'));
  });

  it('omits workdir section when not set', () => {
    const minimal: HarnessConfig = { assertions: [] };
    const body = buildIssueBody('my goal', minimal);
    assert.ok(!body.includes('Workdir'));
  });

  it('embeds parseable config', () => {
    const body = buildIssueBody('my goal', FIXTURE);
    const parsed = parseConfig(body);
    assert.deepEqual(parsed, FIXTURE);
  });
});
