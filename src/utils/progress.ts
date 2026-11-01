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
