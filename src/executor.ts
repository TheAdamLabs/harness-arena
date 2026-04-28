import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import type { Step, StepResult, Assertion, AssertionResult } from './types.js';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 8_000;

function truncate(s: string | undefined, max = MAX_OUTPUT_CHARS): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + `\n…(truncated, ${s.length} total chars)` : s;
}

// ---------------------------------------------------------------------------
// Shell step
// ---------------------------------------------------------------------------

async function executeShell(
  step: Extract<Step, { type: 'shell' }>,
  baseDir: string,
): Promise<StepResult & { index: number }> {
  const cwd = step.cwd ? path.resolve(baseDir, step.cwd) : baseDir;
  const timeout = step.timeout ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();

  try {
    const { stdout, stderr } = await execAsync(step.command, {
      cwd,
      timeout,
      env: { ...process.env, ...step.env },
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      index: 0,
      step,
      ok: true,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      exitCode: 0,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      index: 0,
      step,
      ok: false,
      stdout: truncate(e.stdout),
      stderr: truncate(e.stderr),
      exitCode: typeof e.code === 'number' ? e.code : 1,
      error: e.message,
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// File step
// ---------------------------------------------------------------------------

function executeFile(
  step: Extract<Step, { type: 'file' }>,
  baseDir: string,
): StepResult & { index: number } {
  const filePath = path.resolve(baseDir, step.path);
  const start = Date.now();

  try {
    if (step.action === 'delete') {
      fs.rmSync(filePath, { force: true });
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (step.action === 'append') {
        fs.appendFileSync(filePath, step.content, 'utf8');
      } else {
        fs.writeFileSync(filePath, step.content, 'utf8');
      }
    }
    return { index: 0, step, ok: true, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return {
      index: 0,
      step,
      ok: false,
      error: (err as Error).message,
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Public: execute one step
// ---------------------------------------------------------------------------

export async function executeStep(step: Step, baseDir: string, index: number): Promise<StepResult> {
  let result: StepResult & { index: number };

  if (step.type === 'shell') {
    result = await executeShell(step, baseDir);
  } else {
    result = executeFile(step, baseDir);
  }

  result.index = index;
  return result;
}

// ---------------------------------------------------------------------------
// Public: evaluate one assertion
// ---------------------------------------------------------------------------

export async function evalAssertion(assertion: Assertion, baseDir: string): Promise<AssertionResult> {
  if (assertion.type === 'shell') {
    const cwd = assertion.cwd ? path.resolve(baseDir, assertion.cwd) : baseDir;
    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    try {
      const out = await execAsync(assertion.command, {
        cwd,
        timeout: DEFAULT_TIMEOUT_MS,
        env: process.env as Record<string, string>,
        maxBuffer: 10 * 1024 * 1024,
      });
      stdout = out.stdout;
      stderr = out.stderr;
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
      stdout = e.stdout ?? '';
      stderr = e.stderr ?? '';
      exitCode = typeof e.code === 'number' ? e.code : 1;
    }

    const combined = stdout + stderr;
    const exp = assertion.expect;

    if (exp.exitCode !== undefined && exitCode !== exp.exitCode) {
      return {
        assertion,
        ok: false,
        reason: `exit code ${exitCode}, expected ${exp.exitCode}. stderr: ${truncate(stderr, 400)}`,
      };
    }
    if (exp.contains !== undefined && !combined.includes(exp.contains)) {
      return {
        assertion,
        ok: false,
        reason: `output does not contain "${exp.contains}". got: ${truncate(combined, 400)}`,
      };
    }
    if (exp.notContains !== undefined && combined.includes(exp.notContains)) {
      return {
        assertion,
        ok: false,
        reason: `output unexpectedly contains "${exp.notContains}"`,
      };
    }

    return { assertion, ok: true };
  }

  // File assertion
  const filePath = path.resolve(baseDir, assertion.path);
  const exp = assertion.expect;

  const exists = fs.existsSync(filePath);

  if (exp.exists === true && !exists) {
    return { assertion, ok: false, reason: `file does not exist: ${filePath}` };
  }
  if (exp.exists === false && exists) {
    return { assertion, ok: false, reason: `file unexpectedly exists: ${filePath}` };
  }

  if (exp.contains !== undefined || exp.notContains !== undefined) {
    if (!exists) {
      return { assertion, ok: false, reason: `file not found for content check: ${filePath}` };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (exp.contains !== undefined && !content.includes(exp.contains)) {
      return { assertion, ok: false, reason: `file does not contain "${exp.contains}"` };
    }
    if (exp.notContains !== undefined && content.includes(exp.notContains)) {
      return { assertion, ok: false, reason: `file unexpectedly contains "${exp.notContains}"` };
    }
  }

  return { assertion, ok: true };
}

// ---------------------------------------------------------------------------
// Error classification — drives correction strategy in runner
// ---------------------------------------------------------------------------

export type ErrorClass = 'not_found' | 'timeout' | 'permission' | 'network' | 'hard';

export function classifyError(result: StepResult): ErrorClass {
  const msg = (result.error ?? result.stderr ?? '').toLowerCase();

  if (msg.includes('timeout') || msg.includes('timed out') || result.exitCode === 124) {
    return 'timeout';
  }
  if (msg.includes('no such file') || msg.includes('not found') || msg.includes('command not found')) {
    return 'not_found';
  }
  if (msg.includes('permission denied') || msg.includes('eacces')) {
    return 'permission';
  }
  if (
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('network') ||
    msg.includes('net::err')
  ) {
    return 'network';
  }
  return 'hard';
}
