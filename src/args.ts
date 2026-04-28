/**
 * args.ts
 *
 * Minimal CLI argument parser.
 * Supports positional args and --key value / --key (boolean) flags.
 * Multi-value flags: --assert cmd1 --assert cmd2 → flags.assert = ["cmd1", "cmd2"]
 */

export interface Args {
  positional: string[];
  flags: Record<string, string[]>;
}

export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string[]> = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = [...(flags[key] ?? []), next];
        i += 2;
      } else {
        flags[key] = [...(flags[key] ?? []), 'true'];
        i += 1;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { positional, flags };
}

/** Return the first value for a flag, or undefined. */
export function flag(args: Args, key: string): string | undefined {
  return args.flags[key]?.[0];
}

/** Return all values for a flag (for multi-value flags like --assert). */
export function flags(args: Args, key: string): string[] {
  return args.flags[key] ?? [];
}
