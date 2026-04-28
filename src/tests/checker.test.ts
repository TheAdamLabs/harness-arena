import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { check, formatCheckResult } from '../checker.js';
import type { HarnessConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-checker-test-'));
}

function makeConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return { assertions: [], ...overrides };
}

// ---------------------------------------------------------------------------
// check() — empty assertions
// ---------------------------------------------------------------------------

describe('check — empty assertions', () => {
  it('returns ok:true with empty results when there are no assertions', async () => {
    const result = await check(makeConfig());
    assert.equal(result.ok, true);
    assert.deepEqual(result.results, []);
  });
});

// ---------------------------------------------------------------------------
// check() — file assertions
// ---------------------------------------------------------------------------

describe('check — file assertions', () => {
  it('passes when file exists and exists:true expected', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'hello.txt');
    fs.writeFileSync(file, 'hello');

    const result = await check(
      makeConfig({ assertions: [{ type: 'file', path: 'hello.txt', expect: { exists: true } }] }),
      dir,
    );
    assert.equal(result.ok, true);
    assert.equal(result.results[0]?.ok, true);
  });

  it('fails when file is missing and exists:true expected', async () => {
    const dir = tmpDir();

    const result = await check(
      makeConfig({ assertions: [{ type: 'file', path: 'missing.txt', expect: { exists: true } }] }),
      dir,
    );
    assert.equal(result.ok, false);
    assert.equal(result.results[0]?.ok, false);
    assert.match(result.results[0]?.reason ?? '', /not found/);
  });

  it('passes when file absent and exists:false expected', async () => {
    const dir = tmpDir();

    const result = await check(
      makeConfig({ assertions: [{ type: 'file', path: 'absent.txt', expect: { exists: false } }] }),
      dir,
    );
    assert.equal(result.ok, true);
  });

  it('fails when file present but exists:false expected', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'surprise.txt'), 'oops');

    const result = await check(
      makeConfig({ assertions: [{ type: 'file', path: 'surprise.txt', expect: { exists: false } }] }),
      dir,
    );
    assert.equal(result.ok, false);
    assert.match(result.results[0]?.reason ?? '', /unexpectedly exists/);
  });

  it('passes file contains assertion when string is present', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'src.ts'), '// @returns string');

    const result = await check(
      makeConfig({ assertions: [{ type: 'file', path: 'src.ts', expect: { contains: '@returns' } }] }),
      dir,
    );
    assert.equal(result.ok, true);
  });

  it('fails file contains assertion when string is absent', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'src.ts'), '// no docs here');

    const result = await check(
      makeConfig({ assertions: [{ type: 'file', path: 'src.ts', expect: { contains: '@returns' } }] }),
      dir,
    );
    assert.equal(result.ok, false);
    assert.match(result.results[0]?.reason ?? '', /@returns/);
  });

  it('passes file notContains assertion when string is absent', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'src.ts'), 'clean code');

    const result = await check(
      makeConfig({ assertions: [{ type: 'file', path: 'src.ts', expect: { notContains: 'TODO' } }] }),
      dir,
    );
    assert.equal(result.ok, true);
  });

  it('fails file notContains assertion when string is present', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'src.ts'), '// TODO: fix this');

    const result = await check(
      makeConfig({ assertions: [{ type: 'file', path: 'src.ts', expect: { notContains: 'TODO' } }] }),
      dir,
    );
    assert.equal(result.ok, false);
    assert.match(result.results[0]?.reason ?? '', /TODO/);
  });
});

// ---------------------------------------------------------------------------
// check() — shell assertions
// ---------------------------------------------------------------------------

describe('check — shell assertions', () => {
  it('passes when command exits with expected code 0', async () => {
    const result = await check(
      makeConfig({ assertions: [{ type: 'shell', command: 'true', expect: { exitCode: 0 } }] }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.results[0]?.exitCode, 0);
  });

  it('fails when command exits with unexpected code', async () => {
    const result = await check(
      makeConfig({ assertions: [{ type: 'shell', command: 'false', expect: { exitCode: 0 } }] }),
    );
    assert.equal(result.ok, false);
    assert.match(result.results[0]?.reason ?? '', /exit 1/);
  });

  it('passes when exitCode:1 is expected and command fails', async () => {
    const result = await check(
      makeConfig({ assertions: [{ type: 'shell', command: 'false', expect: { exitCode: 1 } }] }),
    );
    assert.equal(result.ok, true);
  });

  it('captures stdout in result', async () => {
    const result = await check(
      makeConfig({ assertions: [{ type: 'shell', command: 'echo hello', expect: { exitCode: 0 } }] }),
    );
    assert.equal(result.ok, true);
    assert.match(result.results[0]?.stdout ?? '', /hello/);
  });

  it('fails contains check when stdout missing expected string', async () => {
    const result = await check(
      makeConfig({
        assertions: [{ type: 'shell', command: 'echo hello', expect: { exitCode: 0, contains: 'world' } }],
      }),
    );
    assert.equal(result.ok, false);
    assert.match(result.results[0]?.reason ?? '', /missing/);
  });

  it('passes notContains check when stdout does not include the string', async () => {
    const result = await check(
      makeConfig({
        assertions: [{ type: 'shell', command: 'echo hello', expect: { exitCode: 0, notContains: 'world' } }],
      }),
    );
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// formatCheckResult()
// ---------------------------------------------------------------------------

describe('formatCheckResult', () => {
  it('returns a no-assertions message when results are empty', async () => {
    const result = await check(makeConfig());
    const text = formatCheckResult(result);
    assert.match(text, /No assertions/);
  });

  it('contains ✅ for passing assertions', async () => {
    const result = await check(
      makeConfig({ assertions: [{ type: 'shell', command: 'true', expect: { exitCode: 0 } }] }),
    );
    const text = formatCheckResult(result);
    assert.match(text, /✅/);
    assert.match(text, /1\/1/);
  });

  it('contains ❌ and reason for failing assertions', async () => {
    const result = await check(
      makeConfig({ assertions: [{ type: 'shell', command: 'false', expect: { exitCode: 0 } }] }),
    );
    const text = formatCheckResult(result);
    assert.match(text, /❌/);
    assert.match(text, /exit 1/);
    assert.match(text, /0\/1/);
  });

  it('shows passing count across mixed results', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'exists.txt'), 'hi');
    const result = await check(
      makeConfig({
        assertions: [
          { type: 'file', path: 'exists.txt', expect: { exists: true } },
          { type: 'file', path: 'missing.txt', expect: { exists: true } },
        ],
      }),
      dir,
    );
    const text = formatCheckResult(result);
    assert.match(text, /1\/2/);
  });
});
