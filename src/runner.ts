import path from 'path';
import { executeStep, evalAssertion, classifyError } from './executor.js';
import { openIssue, commentAttempt, closeSuccess, markFailed, ensureLabels } from './reporter.js';
import type {
  Task,
  StepResult,
  AssertionResult,
  AttemptResult,
  TaskResult,
} from './types.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function log(msg: string): void {
  process.stdout.write(`[harness] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Correction strategies
// Applied once per step before the failure counts toward a retry.
// ---------------------------------------------------------------------------

async function applyCorrection(
  step: StepResult,
  baseDir: string,
  correctionApplied: boolean,
): Promise<boolean> {
  if (correctionApplied) return false;

  const cls = classifyError(step);

  switch (cls) {
    case 'timeout': {
      log('  correction: sleeping 2 s after timeout');
      await sleep(2000);
      return true;
    }

    case 'network': {
      log('  correction: sleeping 3 s after network error');
      await sleep(3000);
      return true;
    }

    case 'not_found': {
      // If the failed command looks like a missing binary, try `npm install`
      // or `pip install` in the workdir — common in repo improvement tasks.
      const cmd = step.step.type === 'shell' ? step.step.command : '';
      const isMissingBin =
        (step.stderr ?? '').toLowerCase().includes('command not found') ||
        (step.error ?? '').toLowerCase().includes('command not found');

      if (isMissingBin && (cmd.startsWith('npm ') || cmd.startsWith('npx '))) {
        log('  correction: running npm install to restore missing binary');
        await executeStep({ type: 'shell', command: 'npm install' }, baseDir, -1);
        return true;
      }
      return false;
    }

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Format a summary of an attempt for stdout (the GitHub comment is richer)
// ---------------------------------------------------------------------------

function summariseAttempt(result: AttemptResult): void {
  const pass = result.stepResults.filter((r) => r.ok).length;
  const total = result.stepResults.length;
  log(`  steps: ${pass}/${total} passed`);

  for (const r of result.stepResults) {
    if (!r.ok) {
      const label = r.step.type === 'shell'
        ? r.step.command.slice(0, 60)
        : `file:${r.step.action} ${r.step.path}`;
      log(`  ✗ step ${r.index + 1}: ${label}`);
      if (r.stderr) log(`    stderr: ${r.stderr.slice(0, 200)}`);
    }
  }

  for (const a of result.assertionResults) {
    if (!a.ok) {
      log(`  ✗ assertion: ${a.reason ?? 'failed'}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

export async function run(task: Task): Promise<TaskResult> {
  const {
    goal,
    steps,
    assertions = [],
    maxRetries = 3,
    workdir,
    repo,
  } = task;

  const baseDir = workdir ? path.resolve(workdir) : process.cwd();

  log(`Goal: ${goal}`);
  log(`Steps: ${steps.length} | Assertions: ${assertions.length} | Max retries: ${maxRetries}`);
  log(`Working directory: ${baseDir}`);

  // Ensure labels exist and open the tracking issue — both non-fatal.
  let issueHandle = null;
  if (repo) {
    await ensureLabels(repo);
    issueHandle = await openIssue(task, repo);
    if (issueHandle) {
      log(`Issue: ${issueHandle.url}`);
    }
  }

  let lastAttemptResult: AttemptResult | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log(`--- Attempt ${attempt}/${maxRetries} ---`);

    const stepResults: StepResult[] = [];
    let abortError: string | undefined;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const label = step.type === 'shell'
        ? step.command.slice(0, 60)
        : `file:${step.action} ${step.path}`;
      log(`  step ${i + 1}/${steps.length}: ${label}`);

      let result = await executeStep(step, baseDir, i);
      let correctionApplied = false;

      if (!result.ok) {
        const corrected = await applyCorrection(result, baseDir, correctionApplied);
        if (corrected) {
          correctionApplied = true;
          log('  retrying step after correction…');
          result = await executeStep(step, baseDir, i);
        }
      }

      stepResults.push(result);

      if (!result.ok) {
        abortError = result.error ?? `step ${i + 1} failed (exit ${result.exitCode ?? '?'})`;
        log(`  ✗ step ${i + 1} failed — aborting attempt`);
        break;
      }

      log(`  ✓ step ${i + 1} — ${result.durationMs}ms`);
    }

    // Run assertions only when all steps passed.
    const assertionResults: AssertionResult[] = [];
    if (!abortError) {
      log(`  running ${assertions.length} assertion(s)…`);
      for (const assertion of assertions) {
        const r = await evalAssertion(assertion, baseDir);
        assertionResults.push(r);
        if (r.ok) {
          const label = assertion.type === 'shell'
            ? assertion.command.slice(0, 60)
            : assertion.path;
          log(`  ✓ assertion: ${label}`);
        } else {
          log(`  ✗ assertion: ${r.reason}`);
        }
      }
    }

    const allAssertionsPassed = assertionResults.every((r) => r.ok);
    const ok = !abortError && allAssertionsPassed;

    const attemptResult: AttemptResult = {
      attempt,
      ok,
      stepResults,
      assertionResults,
      error: abortError ?? (allAssertionsPassed ? undefined : 'assertions failed'),
    };

    lastAttemptResult = attemptResult;
    summariseAttempt(attemptResult);

    if (issueHandle && repo && !ok) {
      await commentAttempt(issueHandle, repo, attemptResult, task);
    }

    if (ok) {
      log(`Task succeeded on attempt ${attempt}.`);
      if (issueHandle && repo) {
        await closeSuccess(issueHandle, repo, attempt);
      }
      return { ok: true, attempts: attempt, issueUrl: issueHandle?.url };
    }

    if (attempt < maxRetries) {
      const backoffMs = 1000 * attempt;
      log(`  backing off ${backoffMs}ms before next attempt…`);
      await sleep(backoffMs);
    }
  }

  log(`Task failed after ${maxRetries} attempt(s).`);
  if (issueHandle && repo) {
    await markFailed(issueHandle, repo, maxRetries);
  }

  return { ok: false, attempts: maxRetries, issueUrl: issueHandle?.url };
}
