// ---------------------------------------------------------------------------
// Assertions — what harness verifies autonomously.
// The AI agent decides HOW to achieve the goal; harness checks WHETHER it did.
// ---------------------------------------------------------------------------

export interface ShellAssertion {
  type: 'shell';
  /** Command to run. Exit code + output are checked. */
  command: string;
  /** Working directory override (resolved relative to task.workdir or cwd). */
  cwd?: string;
  expect: {
    /** Expected exit code. Default: 0. */
    exitCode?: number;
    /** Combined stdout+stderr must include this string. */
    contains?: string;
    /** Combined stdout+stderr must NOT include this string. */
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
// Task — authored by the AI agent, handed to harness for tracking
// ---------------------------------------------------------------------------

export interface Task {
  /** Human-readable goal; becomes the GitHub Issue title. */
  goal: string;
  /** Target GitHub repo for observability (owner/repo). */
  repo?: string;
  /** Base directory for assertion commands and file paths. Default: cwd. */
  workdir?: string;
  /** Conditions that must all pass for the task to be considered done. */
  assertions?: Assertion[];
}

// ---------------------------------------------------------------------------
// Results returned by checker and CLI commands
// ---------------------------------------------------------------------------

export interface AssertionResult {
  ok: boolean;
  assertion: Assertion;
  /** Human-readable explanation when ok is false. */
  reason?: string | undefined;
}

export interface CheckResult {
  ok: boolean;
  results: AssertionResult[];
}

export interface IssueHandle {
  /** Issue number as a string, e.g. "42". */
  number: string;
  url: string;
}
