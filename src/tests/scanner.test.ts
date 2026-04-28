import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { scan } from '../scanner.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
// harness-arena itself is a TypeScript/Node project — use it as the fixture.
const REPO_ROOT = path.resolve(__dir, '../../');

describe('scanner', () => {
  it('detects TypeScript/Node ecosystem in harness-arena root', () => {
    const result = scan(REPO_ROOT);
    assert.ok(result !== null, 'scan should return a result');
    assert.ok(result.ecosystem.includes('TypeScript'), `expected TypeScript in "${result.ecosystem}"`);
    assert.ok(result.config.assertions.length > 0, 'should generate at least one assertion');
  });

  it('includes tsc --noEmit assertion', () => {
    const result = scan(REPO_ROOT);
    assert.ok(result !== null);
    const hasTsc = result.config.assertions.some(
      (a) => a.type === 'shell' && a.command.includes('tsc')
    );
    assert.ok(hasTsc, 'should include a tsc assertion');
  });

  it('sets workdir to absolute path', () => {
    const result = scan(REPO_ROOT);
    assert.ok(result !== null);
    assert.ok(path.isAbsolute(result.config.workdir ?? ''), 'workdir should be absolute');
  });

  it('returns null for a non-existent directory', () => {
    const result = scan('/nonexistent/path/that/does/not/exist');
    assert.equal(result, null);
  });
});
