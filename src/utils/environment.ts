import * as ciInfo from 'ci-info';
import { PACKAGE_JSON } from '../config/consts.js';

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

// `ci-info` also knows the CI providers that set no `CI`, such as Jenkins and Azure Pipelines.
export function isCi(): boolean {
  return ciInfo.isCI;
}

// A product-token list, as npm's User-Agent is: the CLI's token, then ` ci/<provider>` in CI.
export function resolveClientHeader(): string {
  const clientToken = `cli/${PACKAGE_JSON.version}`;
  return isCi() ? `${clientToken} ci/${resolveCiProvider()}` : clientToken;
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

// The API takes the provider as lowercase letters, digits and dashes: `GitHub Actions` is `github-actions`.
function resolveCiProvider(): string {
  return ciInfo.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? 'unknown';
}
