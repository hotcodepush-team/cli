export interface InteractivityOptions {
  json?: boolean;
  yes?: boolean;
}

/**
 * Colour follows clig.dev: only on a TTY, and never with `NO_COLOR` set or `TERM=dumb`.
 */
export function isColorEnabled(stream: NodeJS.WriteStream): boolean {
  return (
    Boolean(stream.isTTY) &&
    !process.env.NO_COLOR &&
    process.env.TERM !== 'dumb'
  );
}

/**
 * `HOTCODEPUSH_OFFLINE=1`: a build that never asks the API, for one that is never shipped.
 */
export function isOfflineBuild(): boolean {
  return process.env.HOTCODEPUSH_OFFLINE === '1';
}

/**
 * Interactive means a TTY, no `CI` variable, and neither `--json` nor `--yes`:
 * every CI sets `CI`, and a prompt in a pipeline would hang the job even where a TTY exists.
 */
export function isInteractive({ json, yes }: InteractivityOptions): boolean {
  return (
    Boolean(process.stdin.isTTY) &&
    Boolean(process.stdout.isTTY) &&
    !process.env.CI &&
    !json &&
    !yes
  );
}
