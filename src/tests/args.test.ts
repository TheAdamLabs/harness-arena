import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, flag, flags } from '../args.js';

describe('parseArgs — positional arguments', () => {
  it('collects bare positional args', () => {
    const { positional } = parseArgs(['foo', 'bar']);
    assert.deepEqual(positional, ['foo', 'bar']);
  });

  it('returns empty positional when only flags given', () => {
    const { positional } = parseArgs(['--repo', 'owner/repo']);
    assert.deepEqual(positional, []);
  });

  it('separates positional from flags correctly', () => {
    const { positional, flags: f } = parseArgs(['check', '42', '--workdir', '/tmp']);
    assert.deepEqual(positional, ['check', '42']);
    assert.deepEqual(f['workdir'], ['/tmp']);
  });
});

describe('parseArgs — flags', () => {
  it('parses --key value', () => {
    const { flags: f } = parseArgs(['--repo', 'owner/repo']);
    assert.deepEqual(f['repo'], ['owner/repo']);
  });

  it('treats --flag without value as boolean true', () => {
    const { flags: f } = parseArgs(['--verbose']);
    assert.deepEqual(f['verbose'], ['true']);
  });

  it('accumulates multi-value flags', () => {
    const { flags: f } = parseArgs(['--assert', 'npm test', '--assert', 'npx tsc']);
    assert.deepEqual(f['assert'], ['npm test', 'npx tsc']);
  });

  it('handles flag immediately followed by another flag', () => {
    const { flags: f } = parseArgs(['--dry-run', '--repo', 'owner/repo']);
    assert.deepEqual(f['dry-run'], ['true']);
    assert.deepEqual(f['repo'], ['owner/repo']);
  });

  it('returns empty flags object when no flags given', () => {
    const { flags: f } = parseArgs(['scan', '.']);
    assert.deepEqual(f, {});
  });

  it('handles empty argv', () => {
    const result = parseArgs([]);
    assert.deepEqual(result, { positional: [], flags: {} });
  });
});

describe('flag()', () => {
  it('returns the first value for a flag', () => {
    const args = parseArgs(['--repo', 'owner/repo']);
    assert.equal(flag(args, 'repo'), 'owner/repo');
  });

  it('returns undefined for missing flag', () => {
    const args = parseArgs([]);
    assert.equal(flag(args, 'repo'), undefined);
  });

  it('returns first value when flag is multi-value', () => {
    const args = parseArgs(['--assert', 'cmd1', '--assert', 'cmd2']);
    assert.equal(flag(args, 'assert'), 'cmd1');
  });
});

describe('flags()', () => {
  it('returns all values for a multi-value flag', () => {
    const args = parseArgs(['--assert', 'cmd1', '--assert', 'cmd2', '--assert', 'cmd3']);
    assert.deepEqual(flags(args, 'assert'), ['cmd1', 'cmd2', 'cmd3']);
  });

  it('returns empty array for missing flag', () => {
    const args = parseArgs([]);
    assert.deepEqual(flags(args, 'assert'), []);
  });

  it('returns single-element array for one-value flag', () => {
    const args = parseArgs(['--repo', 'owner/repo']);
    assert.deepEqual(flags(args, 'repo'), ['owner/repo']);
  });
});
