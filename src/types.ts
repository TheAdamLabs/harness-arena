// ---------------------------------------------------------------------------
// Step definitions — every action the harness can execute
// ---------------------------------------------------------------------------

export interface ShellStep {
  type: 'shell';
  command: string;
  /** Working directory override (relative to task.workdir or cwd). */
  cwd?: string;
  /** Extra env vars merged onto process.env. */
  env?: Record<string, string>;
  /** Milliseconds before the step is killed. Default: 60 000. */
  timeout?: number;
}

export interface FileWriteStep {
  type: 'file';
  action: 'write' | 'append';
  path: string;
  content: string;
}

export interface FileDeleteStep {
  type: 'file';
  action: 'delete';
  path: string;
}

export type FileStep = FileWriteStep | FileDeleteStep;

export type Step = ShellStep | FileStep;

// ---------------------------------------------------------------------------
// Assertion definitions — checked after all steps pass
// ---------------------------------------------------------------------------

export interface ShellAssertion {
  type: 'shell';
  command: string;
  cwd?: string;
  expect: {
    /** Process exit code. Default: 0. */
    exitCode?: number;
    /** stdout or stderr must include this string. */
    contains?: string;
    /** stdout or stderr must NOT include this string. */
    notContains?: string;
  };
}

export interface FileAssertion {
  type: 'file';
  path: string;
  expect: {
    exists?: boolean;
    contains?: string;
    notContains?: string;
  };
}

export type Assertion = ShellAssertion | FileAssertion;

// ---------------------------------------------------------------------------
// Task — the unit of work an AI agent authors and the harness executes
// ---------------------------------------------------------------------------

export interface Task {
  /** Human-readable goal; becomes the GitHub Issue title. */
  goal: string;
  /** Target GitHub repo for issue observability (owner/repo). */
  repo?: string;
  /** Ordered steps to execute. */
  steps: Step[];
  /** Assertions evaluated after all steps succeed. */
  assertions?: Assertion[];
  /** How many full attempts before giving up. Default: 3. */
  maxRetries?: number;
  /** Absolute or relative base working directory for shell steps. */
  workdir?: string;
}

// ---------------------------------------------------------------------------
// Execution results — surfaced in GitHub Issue comments and stdout
// ---------------------------------------------------------------------------

export interface StepResult {
  index: number;
  step: Step;
  ok: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
  /** Elapsed time in milliseconds. */
  durationMs: number;
}

export interface AssertionResult {
  assertion: Assertion;
  ok: boolean;
  reason?: string;
}

export interface AttemptResult {
  attempt: number;
  ok: boolean;
  stepResults: StepResult[];
  assertionResults: AssertionResult[];
  /** First error that caused the attempt to abort, if any. */
  error?: string | undefined;
}

export interface TaskResult {
  ok: boolean;
  attempts: number;
  issueUrl?: string | undefined;
}
