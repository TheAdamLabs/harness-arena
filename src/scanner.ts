/**
 * scanner.ts
 *
 * Detects a repo's ecosystem and generates sensible default assertions.
 * Lets the agent start a harness loop on any project without having to
 * know the right commands upfront.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Assertion, HarnessConfig, RegressionEntry } from './types.js';

const REGRESSION_FILE = 'HARNESS_REGRESSION.json';

export function readRegressionManifest(workdir: string): RegressionEntry[] {
  const file = path.join(path.resolve(workdir), REGRESSION_FILE);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as RegressionEntry[];
  } catch {
    return [];
  }
}

export function writeRegressionManifest(workdir: string, entries: RegressionEntry[]): void {
  const file = path.join(path.resolve(workdir), REGRESSION_FILE);
  fs.writeFileSync(file, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

interface EcosystemMatch {
  name: string;
  goal: string;
  assertions: Assertion[];
}

function has(dir: string, ...files: string[]): boolean {
  return files.some((f) => fs.existsSync(path.join(dir, f)));
}

function readJson(dir: string, file: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function detect(dir: string): EcosystemMatch[] {
  const matches: EcosystemMatch[] = [];

  // Node / TypeScript
  if (has(dir, 'package.json')) {
    const pkg = readJson(dir, 'package.json');
    const scripts = (pkg['scripts'] as Record<string, string> | undefined) ?? {};
    const assertions: Assertion[] = [];

    if (has(dir, 'tsconfig.json')) {
      assertions.push({
        type: 'shell',
        command: 'npx tsc --noEmit',
        expect: { exitCode: 0 },
      });
    }

    if (has(dir, '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', 'eslint.config.js', 'eslint.config.mjs')) {
      assertions.push({
        type: 'shell',
        command: 'npx eslint . --max-warnings 0',
        expect: { exitCode: 0 },
      });
    }

    if (scripts['test']) {
      assertions.push({
        type: 'shell',
        command: 'npm test -- --passWithNoTests 2>/dev/null || npm test',
        expect: { exitCode: 0 },
      });
    }

    if (scripts['build'] && has(dir, 'tsconfig.json')) {
      assertions.push({
        type: 'shell',
        command: 'npm run build',
        expect: { exitCode: 0 },
      });
    }

    // Always register Node.js/TypeScript even if no scripts were found —
    // the agent can add custom assertions via `harness open --assert`.
    // For plain JS projects without test/build, add a syntax check on
    // the declared entry point if present.
    if (assertions.length === 0) {
      const entry = (pkg['main'] as string | undefined) ??
        (typeof pkg['bin'] === 'string' ? pkg['bin'] : undefined);
      if (entry) {
        assertions.push({
          type: 'shell',
          command: `node --check ${entry}`,
          expect: { exitCode: 0 },
        });
      }
    }

    matches.push({
      name: has(dir, 'tsconfig.json') ? 'TypeScript / Node.js' : 'Node.js',
      goal: 'Ensure all checks pass (types, lint, tests, build)',
      assertions,
    });
  }

  // Rust
  if (has(dir, 'Cargo.toml')) {
    matches.push({
      name: 'Rust',
      goal: 'Ensure cargo check, clippy, and tests all pass',
      assertions: [
        { type: 'shell', command: 'cargo check',                    expect: { exitCode: 0 } },
        { type: 'shell', command: 'cargo clippy -- -D warnings',    expect: { exitCode: 0 } },
        { type: 'shell', command: 'cargo test',                     expect: { exitCode: 0 } },
      ],
    });
  }

  // Python
  if (has(dir, 'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt')) {
    const assertions: Assertion[] = [];

    if (has(dir, 'pyproject.toml')) {
      const raw = fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8');
      if (raw.includes('ruff')) {
        assertions.push({ type: 'shell', command: 'ruff check .', expect: { exitCode: 0 } });
      }
      if (raw.includes('mypy')) {
        assertions.push({ type: 'shell', command: 'mypy .', expect: { exitCode: 0 } });
      }
    }

    assertions.push({ type: 'shell', command: 'python -m pytest --tb=short', expect: { exitCode: 0 } });

    matches.push({ name: 'Python', goal: 'Ensure lint and tests pass', assertions });
  }

  // Go
  if (has(dir, 'go.mod')) {
    matches.push({
      name: 'Go',
      goal: 'Ensure go vet and tests pass',
      assertions: [
        { type: 'shell', command: 'go build ./...',  expect: { exitCode: 0 } },
        { type: 'shell', command: 'go vet ./...',    expect: { exitCode: 0 } },
        { type: 'shell', command: 'go test ./...',   expect: { exitCode: 0 } },
      ],
    });
  }

  // Makefile fallback
  if (matches.length === 0 && has(dir, 'Makefile')) {
    const makefile = fs.readFileSync(path.join(dir, 'Makefile'), 'utf8');
    const targets = (makefile.match(/^[a-z][a-zA-Z0-9_-]*:/gm) ?? []).map((t) => t.slice(0, -1));
    const assertions: Assertion[] = [];

    if (targets.includes('test'))  assertions.push({ type: 'shell', command: 'make test',  expect: { exitCode: 0 } });
    if (targets.includes('lint'))  assertions.push({ type: 'shell', command: 'make lint',  expect: { exitCode: 0 } });
    if (targets.includes('build')) assertions.push({ type: 'shell', command: 'make build', expect: { exitCode: 0 } });

    if (assertions.length > 0) {
      matches.push({ name: 'Makefile', goal: 'Ensure make targets pass', assertions });
    }
  }

  return matches;
}

export interface ScanResult {
  ecosystem: string;
  /** Set only when a goal was explicitly provided. */
  goal?: string | undefined;
  config: HarnessConfig;
}

export function scan(workdir: string, goal?: string): ScanResult | null {
  const absDir = path.resolve(workdir);

  if (!fs.existsSync(absDir)) return null;

  const matches = detect(absDir);
  if (matches.length === 0) return null;

  return {
    ecosystem: matches.map((m) => m.name).join(' + '),
    goal,
    config: { workdir: absDir, assertions: matches.flatMap((m) => m.assertions) },
  };
}

/**
 * Detect the GitHub repo slug (owner/repo) from the git remote in `dir`.
 * Tries `git remote get-url origin`, then falls back to parsing .git/config.
 * Returns null if no GitHub remote is found.
 *
 * Handles both HTTPS and SSH remote formats:
 *   https://github.com/owner/repo.git  → owner/repo
 *   git@github.com:owner/repo.git      → owner/repo
 */
export function detectRepo(dir: string): string | null {
  const absDir = path.resolve(dir);

  // Try git CLI first — most reliable
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: absDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return parseGitHubUrl(url);
  } catch { /* git not available or not a git repo */ }

  // Fallback: read .git/config directly
  try {
    const config = fs.readFileSync(path.join(absDir, '.git', 'config'), 'utf8');
    const match = config.match(/url\s*=\s*(.+)/);
    if (match?.[1]) return parseGitHubUrl(match[1].trim());
  } catch { /* no .git/config */ }

  return null;
}

function parseGitHubUrl(url: string): string | null {
  // HTTPS: https://github.com/owner/repo or https://github.com/owner/repo.git
  const https = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (https?.[1] && https[2]) return `${https[1]}/${https[2]}`;
  return null;
}
