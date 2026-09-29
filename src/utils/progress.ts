import type { InteractivityOptions } from './environment.js';

/**
 * Says what a long command is doing, on stderr and only on a terminal: never under `--json`, never in a log.
 */
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

/**
 * A byte count for a person, 12.3 kB or 4.0 MB, in decimal units as the limits are.
 */
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
