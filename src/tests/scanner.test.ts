import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import { fileURLToPath } from 'url';
import { scan, detectRepo } from '../scanner.js';

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

describe('detectRepo', () => {
  it('detects GitHub repo from harness-arena git remote', () => {
    const repo = detectRepo(REPO_ROOT);
    assert.ok(repo !== null, 'should detect a repo slug');
    assert.match(repo!, /^[\w.-]+\/[\w.-]+$/, 'should be owner/repo format');
    assert.ok(repo!.toLowerCase().includes('harness-arena'), 'should include harness-arena');
  });

  it('returns null for a non-git directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-no-git-'));
    const repo = detectRepo(tmp);
    assert.equal(repo, null);
  });

  it('parses HTTPS remote URL correctly', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-git-'));
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.writeFileSync(
      path.join(tmp, '.git', 'config'),
      '[remote "origin"]\n\turl = https://github.com/myorg/myrepo.git\n',
    );
    const repo = detectRepo(tmp);
    assert.equal(repo, 'myorg/myrepo');
  });

  it('parses SSH remote URL correctly', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-git-'));
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.writeFileSync(
      path.join(tmp, '.git', 'config'),
      '[remote "origin"]\n\turl = git@github.com:myorg/myrepo.git\n',
    );
    const repo = detectRepo(tmp);
    assert.equal(repo, 'myorg/myrepo');
  });

  it('strips .git suffix from repo name', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-git-'));
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.writeFileSync(
      path.join(tmp, '.git', 'config'),
      '[remote "origin"]\n\turl = https://github.com/owner/repo.git\n',
    );
    assert.equal(detectRepo(tmp), 'owner/repo');
  });

  it('returns null for non-GitHub remotes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-git-'));
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.writeFileSync(
      path.join(tmp, '.git', 'config'),
      '[remote "origin"]\n\turl = https://gitlab.com/owner/repo.git\n',
    );
    assert.equal(detectRepo(tmp), null);
  });
});
