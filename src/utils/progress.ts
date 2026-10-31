import type { InteractivityOptions } from './environment.js';

// Progress goes to stderr and only to a terminal, never under `--json` or into a log.
export interface Reporter {
  report(line: string): void;
}

export function createReporter({ json }: InteractivityOptions): Reporter {
  const isReporting = Boolean(process.stderr.isTTY) && !json;
  return {
    report: line => {
      if (isReporting) {
        process.stderr.write(`${line}\n`);
      }
    },
  };
}

// Decimal units, as the limits use.
export function resolveByteText(bytes: number): string {
  if (bytes < 1000) {
    return `${bytes} B`;
  }
  if (bytes < 1_000_000) {
    return `${(bytes / 1000).toFixed(1)} kB`;
  }
  if (bytes < 1_000_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
