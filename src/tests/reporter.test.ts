import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { embedConfig, parseConfig } from '../reporter.js';
import type { HarnessConfig } from '../types.js';

const FIXTURE: HarnessConfig = {
  workdir: '/tmp/test-repo',
  assertions: [
    { type: 'shell', command: 'npx tsc --noEmit', expect: { exitCode: 0 } },
    { type: 'file',  path: 'dist/index.js',       expect: { exists: true } },
  ],
};

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
});
