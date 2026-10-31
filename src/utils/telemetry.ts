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
import {
  ignoreUserConfigErrors,
  readUserConfig,
  writeUserConfig,
} from './user-config.js';

export interface FinishedCommand {
  cliError: CliError | undefined;
  commandName: string;
  durationMs: number;
}

const COMMAND_FINISHED_EVENT = 'cli.command_finished';

// Matches `at <function> (<file>:<line>:<column>)`, or the same without the function and parentheses.
const STACK_FRAME_PATTERN = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

const TELEMETRY_NOTICE =
  'HotCodePush collects anonymous usage and error data to improve the CLI; set HOTCODEPUSH_TELEMETRY_DISABLED=1 to opt out.';

// The longest telemetry may delay the exit, requests included.
const TELEMETRY_TIMEOUT_MS = 1500;

// Only the release build has keys, so every other build reports nothing.
export function isTelemetryEnabled(): boolean {
  return (
    (POSTHOG_PROJECT_KEY !== '' || SENTRY_DSN !== '') &&
    process.env.HOTCODEPUSH_TELEMETRY_DISABLED !== '1' &&
    process.env.DO_NOT_TRACK !== '1'
  );
}

export function printTelemetryNotice(): void {
  if (!isTelemetryEnabled()) {
    return;
  }
  ignoreUserConfigErrors(() => {
    const userConfig = readUserConfig();
    if (userConfig.telemetryNoticeShownAt !== undefined) {
      return;
    }
    process.stderr.write(`${TELEMETRY_NOTICE}\n`);
    writeUserConfig({
      ...userConfig,
      telemetryNoticeShownAt: new Date().toISOString(),
    });
  });
}

// Telemetry must never fail a command or hold up its exit for long.
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

// Drops the message above the frames, since it can hold user data.
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

// A local path never leaves the machine: a package file keeps the part from `node_modules` on, any other only its name.
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

// The host name is hashed, so it is never sent as it is.
function resolveMachineId(): string {
  return createHash('sha256').update(hostname()).digest('hex');
}

// Imported lazily, since the framework modules load native-project parsers that a build without telemetry never needs.
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

// The event carries only these properties: no argument, no path and no project name.
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
        // Keeps the event anonymous: no location from the IP address and no person profile.
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

// Only our own bugs reach Sentry. Every other error comes from user input or an API answer.
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

async function waitAtMost(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  await Promise.race([
    promise.catch(() => undefined),
    setTimeout(timeoutMs, undefined, { ref: false }),
  ]);
}
