import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dir = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dir, '../../dist/index.js');

async function helpOutput(): Promise<string> {
  const { stdout } = await execFileAsync('node', [CLI, 'help']);
  return stdout;
}

const COMMANDS = ['scan', 'open', 'check', 'log', 'done', 'fail', 'context', 'history', 'help'];

describe('harness help', () => {
  it('exits 0 and produces output', async () => {
    const out = await helpOutput();
    assert.ok(out.length > 0, 'help output should not be empty');
  });

  for (const cmd of COMMANDS) {
    it(`mentions the "${cmd}" command`, async () => {
      const out = await helpOutput();
      assert.ok(out.includes(`harness ${cmd}`), `help should mention "harness ${cmd}"`);
    });
  }

  it('mentions GITHUB_TOKEN environment variable', async () => {
    const out = await helpOutput();
    assert.ok(out.includes('GITHUB_TOKEN'));
  });

  it('mentions GITHUB_REPO environment variable', async () => {
    const out = await helpOutput();
    assert.ok(out.includes('GITHUB_REPO'));
  });

  it('mentions --repo flag', async () => {
    const out = await helpOutput();
    assert.ok(out.includes('--repo'));
  });

  it('mentions --workdir flag', async () => {
    const out = await helpOutput();
    assert.ok(out.includes('--workdir'));
  });
});
