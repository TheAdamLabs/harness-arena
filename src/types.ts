// ---------------------------------------------------------------------------
// Assertions — what harness verifies. The AI agent decides how to get there.
// ---------------------------------------------------------------------------

export interface ShellAssertion {
  type: 'shell';
  command: string;
  /** Working directory override, resolved relative to HarnessConfig.workdir. */
  cwd?: string;
  expect: {
    exitCode?: number;
    contains?: string;
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
// Issue types — purely informational, stored in config. No enforcement.
// The agent decides whether the assertion quality matches the type.
//   fix          — code change, structural assertions fine
//   correctness  — behavioural assertions required (run the actual system)
//   performance  — timing assertions required
//   workflow     — end-to-end workflow run + report file check
//   spike        — exploration; produces observations, not assertions
// ---------------------------------------------------------------------------

export type IssueType = 'fix' | 'correctness' | 'performance' | 'workflow' | 'spike';

// ---------------------------------------------------------------------------
// HarnessConfig — embedded in the GitHub Issue body as a hidden HTML comment.
// This is the single source of truth; no local file needed.
// ---------------------------------------------------------------------------

export interface HarnessConfig {
  /** Absolute path where assertion commands run. Defaults to process.cwd(). */
  workdir?: string | undefined;
  assertions: Assertion[];
  /** Optional type hint — guides what kind of assertions are appropriate. */
  type?: IssueType | undefined;
}

// ---------------------------------------------------------------------------
// Regression manifest — written to HARNESS_REGRESSION.json in the workdir
// by `harness done`. Read by `harness scan` to detect regressions.
// ---------------------------------------------------------------------------

export interface RegressionEntry {
  issue: string;
  goal: string;
  closedAt: string;
  assertions: Assertion[];
}

// ---------------------------------------------------------------------------
// Results — include raw output so agents don't need a second round-trip
// ---------------------------------------------------------------------------

export interface AssertionResult {
  ok: boolean;
  assertion: Assertion;
  /** Human-readable reason when ok is false. */
  reason?: string | undefined;
  /** Captured stdout from shell assertions. */
  stdout?: string | undefined;
  /** Captured stderr from shell assertions. */
  stderr?: string | undefined;
  exitCode?: number | undefined;
}

export interface CheckResult {
  ok: boolean;
  results: AssertionResult[];
}

// ---------------------------------------------------------------------------
// Issue types
// ---------------------------------------------------------------------------

export interface IssueHandle {
  number: string;
  url: string;
  goal: string;
}

export interface IssueSummary {
  number: string;
  url: string;
  goal: string;
  status: 'running' | 'succeeded' | 'failed' | 'triage' | 'spike' | 'unknown';
  updatedAt: string;
}

export interface IssueContext {
  number: string;
  url: string;
  goal: string;
  status: 'running' | 'succeeded' | 'failed' | 'triage' | 'spike' | 'unknown';
  config: HarnessConfig;
  /** All comments in chronological order — the full attempt history. */
  attempts: Array<{ id: number; body: string; createdAt: string }>;
}
