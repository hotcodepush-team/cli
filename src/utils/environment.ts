export interface InteractivityOptions {
  json?: boolean;
  noInput?: boolean;
  yes?: boolean;
}

// Follows the colour rules of clig.dev.
export function isColorEnabled(stream: NodeJS.WriteStream): boolean {
  return (
    Boolean(stream.isTTY) &&
    !process.env.NO_COLOR &&
    process.env.TERM !== 'dumb'
  );
}

// GitHub Actions and the other CI runners set `CI`.
export function isCi(): boolean {
  return Boolean(process.env.CI);
}

// For a build that is never shipped.
export function isOfflineBuild(): boolean {
  return process.env.HOTCODEPUSH_OFFLINE === '1';
}

// A prompt in a pipeline would hang the job, even where a TTY exists.
// `--json` only formats: a program reading stdout is no terminal and gets the error naming the flag, as gh does.
export function isInteractive({ noInput, yes }: InteractivityOptions): boolean {
  return (
    Boolean(process.stdin.isTTY) &&
    Boolean(process.stdout.isTTY) &&
    !isCi() &&
    !noInput &&
    !yes
  );
}
