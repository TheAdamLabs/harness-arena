/**
 * scanner.ts
 *
 * Detects a repo's ecosystem and generates sensible default assertions.
 * Lets the agent start a harness loop on any project without having to
 * know the right commands upfront.
 */

import fs from 'fs';
import path from 'path';
import type { Assertion, HarnessConfig } from './types.js';

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

    if (assertions.length > 0) {
      matches.push({
        name: has(dir, 'tsconfig.json') ? 'TypeScript / Node.js' : 'Node.js',
        goal: 'Ensure all checks pass (types, lint, tests, build)',
        assertions,
      });
    }
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
  goal: string;
  config: HarnessConfig;
}

export function scan(workdir: string, goalOverride?: string): ScanResult | null {
  const absDir = path.resolve(workdir);

  if (!fs.existsSync(absDir)) return null;

  const matches = detect(absDir);
  if (matches.length === 0) return null;

  // Merge all detected assertions into a single config.
  const combined = matches.flatMap((m) => m.assertions);
  const ecosystem = matches.map((m) => m.name).join(' + ');
  const goal = goalOverride ?? matches[0]!.goal;

  return {
    ecosystem,
    goal,
    config: { workdir: absDir, assertions: combined },
  };
}
