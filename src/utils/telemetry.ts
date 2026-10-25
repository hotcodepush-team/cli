import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { basename } from 'node:path/posix';
import { setTimeout } from 'node:timers/promises';
import {
  PACKAGE_JSON,
  POSTHOG_HOST,
  POSTHOG_PROJECT_KEY,
  SENTRY_DSN,
} from '../config/consts.js';
import { isCi } from './environment.js';
import type { CliError } from './errors.js';
import {
  ReportedFailureError,
  UnexpectedError,
  UnexpectedResponseError,
} from './errors.js';
import type { Framework } from './framework.js';
import { readUserConfig, writeUserConfig } from './user-config.js';

/**
 * A command line that ran one command: its registered name, the error it ended with, none when it succeeded, and how long it took.
 */
export interface FinishedCommand {
  cliError: CliError | undefined;
  commandName: string;
  durationMs: number;
}

const COMMAND_FINISHED_EVENT = 'cli.command_finished';

// a stack line with a location: `at <function> (<file>:<line>:<column>)`, or without the function and its parentheses
const STACK_FRAME_PATTERN = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

const TELEMETRY_NOTICE =
  'HotCodePush collects anonymous usage and error data to improve the CLI; set HOTCODEPUSH_TELEMETRY_DISABLED=1 to opt out.';

// the longest telemetry holds up the exit, its requests included
const TELEMETRY_TIMEOUT_MS = 1500;

/**
 * Whether this build reports anything: a key the release build wrote, and neither switch set,
 * `HOTCODEPUSH_TELEMETRY_DISABLED=1` or the cross-tool `DO_NOT_TRACK=1`, each turning off usage and errors alike.
 */
export function isTelemetryEnabled(): boolean {
  return (
    (POSTHOG_PROJECT_KEY !== '' || SENTRY_DSN !== '') &&
    process.env.HOTCODEPUSH_TELEMETRY_DISABLED !== '1' &&
    process.env.DO_NOT_TRACK !== '1'
  );
}

/**
 * The one line of the first run on a machine, on stderr so `--json` stays data, remembered in config.json.
 */
export function printTelemetryNotice(): void {
  if (!isTelemetryEnabled()) {
    return;
  }
  try {
    const userConfig = readUserConfig();
    if (userConfig.telemetryNoticeShownAt !== undefined) {
      return;
    }
    process.stderr.write(`${TELEMETRY_NOTICE}\n`);
    writeUserConfig({
      ...userConfig,
      telemetryNoticeShownAt: new Date().toISOString(),
    });
  } catch {
    // a config.json the CLI cannot read or write is the command's to report, never the notice's
  }
}

/**
 * The command's usage event to PostHog and its unexpected error to Sentry, waited for at most `TELEMETRY_TIMEOUT_MS`
 * and silent when they fail, so telemetry never fails a command or holds up its exit for long.
 */
export async function reportFinishedCommand(
  finishedCommand: FinishedCommand,
): Promise<void> {
  if (!isTelemetryEnabled()) {
    return;
  }
  await waitAtMost(
    Promise.allSettled([
      sendCommandFinishedEvent(finishedCommand),
      sendUnexpectedErrorEvent(finishedCommand),
    ]),
    TELEMETRY_TIMEOUT_MS,
  );
}

/**
 * The stack's frames without the message above them, each file cut to the part below `node_modules` or to its name.
 */
export function resolveScrubbedStack(stack: string): string {
  return stack
    .split('\n')
    .filter(line => /^\s*at /.test(line))
    .map(line => {
      const [, functionName, filePath, lineNumber, columnNumber] =
        STACK_FRAME_PATTERN.exec(line) ?? [];
      if (filePath === undefined) {
        return line.trim();
      }
      const location = `${resolveFramePath(filePath)}:${lineNumber}:${columnNumber}`;
      return functionName === undefined
        ? `at ${location}`
        : `at ${functionName} (${location})`;
    })
    .join('\n');
}

/**
 * A stack frame's file: a Node internal as it is, a package's from its last `node_modules` on, any other by its name alone.
 */
function resolveFramePath(filePath: string): string {
  const normalizedPath = filePath
    .replace(/^file:\/\//, '')
    .replaceAll('\\', '/');
  if (normalizedPath.startsWith('node:')) {
    return normalizedPath;
  }
  const nodeModulesIndex = normalizedPath.lastIndexOf('node_modules/');
  return nodeModulesIndex === -1
    ? basename(normalizedPath)
    : normalizedPath.slice(nodeModulesIndex);
}

/**
 * The anonymous id a machine's events share: its host name hashed, never sent as it is.
 */
function resolveMachineId(): string {
  return createHash('sha256').update(hostname()).digest('hex');
}

/**
 * The framework of the project the command ran in, none outside one. Imported here, since the framework modules
 * load the native-project parsers, which a build without telemetry never needs.
 */
async function resolveProjectFramework(): Promise<Framework | null> {
  try {
    const [{ detectFramework }, { locateProjectConfigFile }] =
      await Promise.all([
        import('./framework.js'),
        import('./project-config.js'),
      ]);
    return detectFramework(locateProjectConfigFile(undefined).directoryPath);
  } catch {
    return null;
  }
}

/**
 * `cli.command_finished` to PostHog's capture endpoint, its properties and nothing else: no argument, no path, no name
 * from the project.
 */
async function sendCommandFinishedEvent({
  cliError,
  commandName,
  durationMs,
}: FinishedCommand): Promise<void> {
  if (POSTHOG_PROJECT_KEY === '') {
    return;
  }
  await fetch(`${POSTHOG_HOST}/capture/`, {
    body: JSON.stringify({
      api_key: POSTHOG_PROJECT_KEY,
      distinct_id: resolveMachineId(),
      event: COMMAND_FINISHED_EVENT,
      properties: {
        // anonymous: no location from the address, and no person profile behind the machine's id
        $geoip_disable: true,
        $process_person_profile: false,
        cli_version: PACKAGE_JSON.version,
        command: commandName,
        duration_ms: Math.round(durationMs),
        framework: await resolveProjectFramework(),
        is_ci: isCi(),
        outcome: cliError === undefined ? 'succeeded' : 'failed',
        source: 'cli',
        ...(commandName === 'init' && {
          stopped_step:
            cliError instanceof ReportedFailureError
              ? (cliError.stoppedStep ?? null)
              : null,
        }),
      },
      timestamp: new Date().toISOString(),
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(TELEMETRY_TIMEOUT_MS),
  });
}

/**
 * An error that is our bug, `unexpected` or an API answer outside its shape, to Sentry's envelope endpoint: its
 * type, its scrubbed stack, which Sentry groups by, and its code; every other error is the user's input or the API's
 * answer and never reaches Sentry.
 */
async function sendUnexpectedErrorEvent({
  cliError,
  commandName,
}: FinishedCommand): Promise<void> {
  if (
    SENTRY_DSN === '' ||
    !(
      cliError instanceof UnexpectedError ||
      cliError instanceof UnexpectedResponseError
    )
  ) {
    return;
  }
  const reportedError =
    cliError.cause instanceof Error ? cliError.cause : cliError;
  const { host, pathname, username: publicKey } = new URL(SENTRY_DSN);
  const eventId = randomUUID().replaceAll('-', '');
  const sentAt = new Date().toISOString();
  const event = {
    event_id: eventId,
    exception: {
      values: [
        {
          type: reportedError.name,
          value: resolveScrubbedStack(reportedError.stack ?? ''),
        },
      ],
    },
    platform: 'node',
    release: `${PACKAGE_JSON.name}@${PACKAGE_JSON.version}`,
    tags: { code: cliError.code, command: commandName },
    timestamp: sentAt,
  };
  await fetch(`https://${host}/api${pathname}/envelope/`, {
    body: [{ event_id: eventId, sent_at: sentAt }, { type: 'event' }, event]
      .map(line => JSON.stringify(line))
      .join('\n'),
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=${PACKAGE_JSON.name}/${PACKAGE_JSON.version}`,
    },
    method: 'POST',
    signal: AbortSignal.timeout(TELEMETRY_TIMEOUT_MS),
  });
}

/**
 * Waits for the promise at most the given time and never for its failure; the timer keeps no process alive.
 */
async function waitAtMost(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  await Promise.race([
    promise.catch(() => undefined),
    setTimeout(timeoutMs, undefined, { ref: false }),
  ]);
}
