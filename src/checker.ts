/**
 * checker.ts
 *
 * Evaluates assertions from a HarnessConfig.
 * Includes full stdout/stderr in results so agents never need a second
 * round-trip to understand why an assertion failed.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import type { Assertion, AssertionResult, CheckResult, HarnessConfig } from './types.js';

const execAsync = promisify(exec);
const MAX_OUTPUT = 6_000;

function trim(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  return t.length > MAX_OUTPUT ? t.slice(0, MAX_OUTPUT) + `\n…(${t.length} chars total)` : t;
}

async function checkShell(
  a: Extract<Assertion, { type: 'shell' }>,
  baseDir: string,
): Promise<AssertionResult> {
  const cwd = a.cwd ? path.resolve(baseDir, a.cwd) : baseDir;
  let rawOut = '';
  let rawErr = '';
  let exitCode = 0;

  try {
    const result = await execAsync(a.command, { cwd, timeout: 120_000, maxBuffer: 10_485_760 });
    rawOut = result.stdout;
    rawErr = result.stderr;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    rawOut = e.stdout ?? '';
    rawErr = e.stderr ?? '';
    exitCode = typeof e.code === 'number' ? e.code : 1;
  }

  const combined = rawOut + rawErr;
  const { expect: exp } = a;
  const expectedCode = exp.exitCode ?? 0;

  const base: Pick<AssertionResult, 'assertion' | 'stdout' | 'stderr' | 'exitCode'> = {
    assertion: a,
    stdout: trim(rawOut),
    stderr: trim(rawErr),
    exitCode,
  };

  if (exitCode !== expectedCode) {
    return {
      ...base,
      ok: false,
      reason: `exit ${exitCode} (expected ${expectedCode})`,
    };
  }
  if (exp.contains !== undefined && !combined.includes(exp.contains)) {
    return { ...base, ok: false, reason: `output missing "${exp.contains}"` };
  }
  if (exp.notContains !== undefined && combined.includes(exp.notContains)) {
    return { ...base, ok: false, reason: `output unexpectedly contains "${exp.notContains}"` };
  }

  return { ...base, ok: true };
}

function checkFile(
  a: Extract<Assertion, { type: 'file' }>,
  baseDir: string,
): AssertionResult {
  const filePath = path.resolve(baseDir, a.path);
  const { expect: exp } = a;
  const exists = fs.existsSync(filePath);

  if (exp.exists === true && !exists)  return { ok: false, assertion: a, reason: `not found: ${filePath}` };
  if (exp.exists === false && exists)  return { ok: false, assertion: a, reason: `unexpectedly exists: ${filePath}` };

  if (exists && (exp.contains !== undefined || exp.notContains !== undefined)) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (exp.contains    !== undefined && !content.includes(exp.contains))    return { ok: false, assertion: a, reason: `"${exp.contains}" not found in ${a.path}` };
    if (exp.notContains !== undefined &&  content.includes(exp.notContains)) return { ok: false, assertion: a, reason: `"${exp.notContains}" found in ${a.path}` };
  }

  return { ok: true, assertion: a };
}

export async function check(config: HarnessConfig, workdirOverride?: string): Promise<CheckResult> {
  const assertions = config.assertions;
  const baseDir = path.resolve(workdirOverride ?? config.workdir ?? process.cwd());

  if (assertions.length === 0) return { ok: true, results: [] };

  const results: AssertionResult[] = [];
  for (const assertion of assertions) {
    results.push(
      assertion.type === 'shell'
        ? await checkShell(assertion, baseDir)
        : checkFile(assertion, baseDir),
    );
  }

  return { ok: results.every((r) => r.ok), results };
}

export function formatCheckResult(result: CheckResult): string {
  if (result.results.length === 0) return 'No assertions — nothing to check.';

  const lines: string[] = [];
  for (const r of result.results) {
    const label = r.assertion.type === 'shell'
      ? `shell: \`${r.assertion.command.slice(0, 80)}\``
      : `file:  \`${r.assertion.path}\``;

    lines.push(`${r.ok ? '✅' : '❌'} ${label}`);

    if (!r.ok) {
      if (r.reason)  lines.push(`   reason: ${r.reason}`);
      if (r.stderr)  lines.push(`   stderr: ${r.stderr.split('\n').slice(0, 8).join('\n           ')}`);
      else if (r.stdout) lines.push(`   stdout: ${r.stdout.split('\n').slice(0, 8).join('\n           ')}`);
    }
  }

  const passed = result.results.filter((r) => r.ok).length;
  lines.push('', `${passed}/${result.results.length} assertions passed`);
  return lines.join('\n');
}
