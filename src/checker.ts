/**
 * checker.ts
 *
 * Evaluates assertions against the current state of the repo.
 * This is the only place harness runs anything — assertions are read-only
 * verification, never action. All actual work is done by the AI agent.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import type { Assertion, AssertionResult, CheckResult, Task } from './types.js';

const execAsync = promisify(exec);
const MAX_OUTPUT = 4_000;

function truncate(s: string | undefined): string {
  if (!s) return '';
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `…(${s.length} chars total)` : s;
}

async function checkShell(
  a: Extract<Assertion, { type: 'shell' }>,
  baseDir: string,
): Promise<AssertionResult> {
  const cwd = a.cwd ? path.resolve(baseDir, a.cwd) : baseDir;
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    const out = await execAsync(a.command, { cwd, timeout: 60_000, maxBuffer: 10_485_760 });
    stdout = out.stdout;
    stderr = out.stderr;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
    exitCode = typeof e.code === 'number' ? e.code : 1;
  }

  const combined = stdout + stderr;
  const { expect: exp } = a;

  const expectedCode = exp.exitCode ?? 0;
  if (exitCode !== expectedCode) {
    return {
      ok: false,
      assertion: a,
      reason: `exit ${exitCode} (expected ${expectedCode})\n${truncate(stderr) || truncate(stdout)}`,
    };
  }
  if (exp.contains !== undefined && !combined.includes(exp.contains)) {
    return {
      ok: false,
      assertion: a,
      reason: `output missing "${exp.contains}"\ngot: ${truncate(combined)}`,
    };
  }
  if (exp.notContains !== undefined && combined.includes(exp.notContains)) {
    return {
      ok: false,
      assertion: a,
      reason: `output unexpectedly contains "${exp.notContains}"`,
    };
  }

  return { ok: true, assertion: a };
}

function checkFile(
  a: Extract<Assertion, { type: 'file' }>,
  baseDir: string,
): AssertionResult {
  const filePath = path.resolve(baseDir, a.path);
  const { expect: exp } = a;
  const exists = fs.existsSync(filePath);

  if (exp.exists === true && !exists) {
    return { ok: false, assertion: a, reason: `file not found: ${filePath}` };
  }
  if (exp.exists === false && exists) {
    return { ok: false, assertion: a, reason: `file unexpectedly exists: ${filePath}` };
  }
  if ((exp.contains !== undefined || exp.notContains !== undefined) && exists) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (exp.contains !== undefined && !content.includes(exp.contains)) {
      return { ok: false, assertion: a, reason: `"${exp.contains}" not found in ${filePath}` };
    }
    if (exp.notContains !== undefined && content.includes(exp.notContains)) {
      return { ok: false, assertion: a, reason: `"${exp.notContains}" found in ${filePath}` };
    }
  }

  return { ok: true, assertion: a };
}

export async function check(task: Task): Promise<CheckResult> {
  const assertions = task.assertions ?? [];
  const baseDir = task.workdir ? path.resolve(task.workdir) : process.cwd();

  if (assertions.length === 0) {
    return { ok: true, results: [] };
  }

  const results: AssertionResult[] = [];
  for (const assertion of assertions) {
    const result = assertion.type === 'shell'
      ? await checkShell(assertion, baseDir)
      : checkFile(assertion, baseDir);
    results.push(result);
  }

  return { ok: results.every((r) => r.ok), results };
}

export function formatCheckResult(result: CheckResult): string {
  if (result.results.length === 0) return 'No assertions defined — nothing to check.';

  const lines: string[] = [];
  for (const r of result.results) {
    const label = r.assertion.type === 'shell'
      ? `shell: \`${r.assertion.command.slice(0, 80)}\``
      : `file: \`${r.assertion.path}\``;
    lines.push(`${r.ok ? '✅' : '❌'} ${label}${r.reason ? `\n   ${r.reason.split('\n')[0]}` : ''}`);
  }

  const passed = result.results.filter((r) => r.ok).length;
  lines.push('');
  lines.push(`${passed}/${result.results.length} assertions passed`);
  return lines.join('\n');
}
