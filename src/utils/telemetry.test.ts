import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { HotCodePushError } from '@hotcodepush/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as constsModule from '../config/consts.js';
import {
  InvalidParameterError,
  ReportedFailureError,
  UnexpectedError,
  UnexpectedResponseError,
} from './errors.js';
import {
  printTelemetryNotice,
  reportFinishedCommand,
  resolveScrubbedStack,
} from './telemetry.js';
import { readUserConfig, writeUserConfig } from './user-config.js';

vi.mock('../config/consts.js', async importOriginal => ({
  ...(await importOriginal<typeof constsModule>()),
  POSTHOG_PROJECT_KEY: 'phc_example',
  SENTRY_DSN: 'https://publickey@o0.ingest.de.sentry.io/0',
}));

const CAPTURE_URL = 'https://hotcodepush.com/ingest/capture/';

const ENVELOPE_URL = 'https://o0.ingest.de.sentry.io/api/0/envelope/';

const STACK = [
  "RangeError: ENOENT: no such file or directory, open '/Users/anna/app/hotcodepush.json'",
  'which spans a second line',
  '    at runCli (/Users/anna/.npm/_npx/1a2b/node_modules/hotcodepush/dist/utils/cli.js:16:39)',
  '    at file:///C:/Users/anna/cli/dist/index.js:80:20',
  '    at new Promise (<anonymous>)',
  '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
].join('\n');

const SCRUBBED_STACK = [
  'at runCli (node_modules/hotcodepush/dist/utils/cli.js:16:39)',
  'at index.js:80:20',
  'at new Promise (<anonymous>)',
  'at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
].join('\n');

const TELEMETRY_NOTICE =
  'HotCodePush collects anonymous usage and error data to improve the CLI; set HOTCODEPUSH_TELEMETRY_DISABLED=1 to opt out.\n';

describe('telemetry', () => {
  const fakeFetch = vi.fn<
    (url: string, init: RequestInit) => Promise<Response>
  >(async () => new Response('{}'));
  let temporaryDirectoryPath = '';

  beforeEach(() => {
    temporaryDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-'));
    vi.stubEnv('APPDATA', temporaryDirectoryPath);
    vi.stubEnv('CI', undefined);
    vi.stubEnv('DO_NOT_TRACK', undefined);
    vi.stubEnv('HOTCODEPUSH_TELEMETRY_DISABLED', undefined);
    vi.stubEnv('XDG_CONFIG_HOME', temporaryDirectoryPath);
    vi.stubGlobal('fetch', fakeFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(temporaryDirectoryPath, { force: true, recursive: true });
  });

  function readRequest(url: string): { body: string; init: RequestInit } {
    const [, init] =
      fakeFetch.mock.calls.find(([calledUrl]) => calledUrl === url) ?? [];
    if (init === undefined) {
      throw new Error(`No request to ${url}.`);
    }
    return { body: String(init.body), init };
  }

  function readCapturedProperties(): Record<string, unknown> {
    return (
      JSON.parse(readRequest(CAPTURE_URL).body) as {
        properties: Record<string, unknown>;
      }
    ).properties;
  }

  function createCause(cause: Error): Error {
    cause.stack = STACK;
    return cause;
  }

  describe('reportFinishedCommand', () => {
    it("should post cli.command_finished to PostHog's capture endpoint with its properties, under the hashed machine id", async () => {
      vi.stubEnv('CI', 'true');

      await reportFinishedCommand({
        cliError: undefined,
        commandName: 'release create',
        durationMs: 1234.6,
      });

      expect(fakeFetch).toHaveBeenCalledTimes(1);
      const { body, init } = readRequest(CAPTURE_URL);
      expect(init).toMatchObject({
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: expect.any(AbortSignal),
      });
      expect(JSON.parse(body)).toEqual({
        api_key: 'phc_example',
        distinct_id: createHash('sha256').update(hostname()).digest('hex'),
        event: 'cli.command_finished',
        properties: {
          $geoip_disable: true,
          $process_person_profile: false,
          cli_version: '0.0.0',
          command: 'release create',
          duration_ms: 1235,
          framework: null,
          is_ci: true,
          outcome: 'succeeded',
          source: 'cli',
        },
        timestamp: expect.any(String),
      });
    });

    it('should send the framework of the project the command ran in', async () => {
      writeFileSync(
        join(temporaryDirectoryPath, 'package.json'),
        JSON.stringify({ dependencies: { '@capacitor/core': '8.0.0' } }),
      );
      vi.spyOn(process, 'cwd').mockReturnValue(temporaryDirectoryPath);

      await reportFinishedCommand({
        cliError: undefined,
        commandName: 'bundle upload',
        durationMs: 10,
      });

      expect(readCapturedProperties()).toMatchObject({
        framework: 'capacitor',
      });
    });

    it('should name the step init stopped at', async () => {
      await reportFinishedCommand({
        cliError: new ReportedFailureError('E_NOT_LOGGED_IN', 'sign-in'),
        commandName: 'init',
        durationMs: 10,
      });

      expect(readCapturedProperties()).toMatchObject({
        outcome: 'failed',
        stopped_step: 'sign-in',
      });
    });

    it('should post an unexpected error to Sentry as one envelope: its type, its scrubbed stack, its code and the command', async () => {
      await reportFinishedCommand({
        cliError: new UnexpectedError(createCause(new RangeError('boom'))),
        commandName: 'bundle upload',
        durationMs: 10,
      });

      const { body, init } = readRequest(ENVELOPE_URL);
      expect(init).toMatchObject({
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth':
            'Sentry sentry_version=7, sentry_key=publickey, sentry_client=hotcodepush/0.0.0',
        },
        method: 'POST',
        signal: expect.any(AbortSignal),
      });
      const [envelopeHeader, itemHeader, event] = body
        .split('\n')
        .map(line => JSON.parse(line) as Record<string, unknown>);
      expect(envelopeHeader).toEqual({
        event_id: expect.stringMatching(/^[0-9a-f]{32}$/),
        sent_at: expect.any(String),
      });
      expect(itemHeader).toEqual({ type: 'event' });
      expect(event).toEqual({
        event_id: envelopeHeader?.event_id,
        exception: { values: [{ type: 'RangeError', value: SCRUBBED_STACK }] },
        platform: 'node',
        release: 'hotcodepush@0.0.0',
        tags: { code: 'E_UNEXPECTED', command: 'bundle upload' },
        timestamp: envelopeHeader?.sent_at,
      });
      expect(body).not.toContain('anna');
    });

    it("should post an API answer outside the API's shape to Sentry with the typed client's stack", async () => {
      const cause = createCause(
        new HotCodePushError(
          {
            code: 'E_UNEXPECTED_RESPONSE',
            details: null,
            message: 'The response is not JSON.',
          },
          502,
        ),
      );

      await reportFinishedCommand({
        cliError: new UnexpectedResponseError(502, cause),
        commandName: 'release list',
        durationMs: 10,
      });

      const [, , event] = readRequest(ENVELOPE_URL).body.split('\n');
      expect(JSON.parse(event ?? '')).toMatchObject({
        exception: { values: [{ value: SCRUBBED_STACK }] },
        tags: { code: 'E_UNEXPECTED_RESPONSE', command: 'release list' },
      });
    });

    it('should never post an error of the catalog to Sentry', async () => {
      await reportFinishedCommand({
        cliError: new InvalidParameterError('The value is invalid.'),
        commandName: 'channel create',
        durationMs: 10,
      });

      expect(fakeFetch.mock.calls.map(([url]) => url)).toEqual([CAPTURE_URL]);
      expect(readCapturedProperties()).toMatchObject({ outcome: 'failed' });
    });

    it.each(['HOTCODEPUSH_TELEMETRY_DISABLED', 'DO_NOT_TRACK'])(
      'should send nothing when %s=1',
      async variableName => {
        vi.stubEnv(variableName, '1');

        await reportFinishedCommand({
          cliError: new UnexpectedError(new TypeError('boom')),
          commandName: 'whoami',
          durationMs: 10,
        });

        expect(fakeFetch).not.toHaveBeenCalled();
      },
    );

    it('should resolve silently when both requests fail', async () => {
      fakeFetch.mockRejectedValue(new TypeError('fetch failed'));
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const stderrWrite = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      await expect(
        reportFinishedCommand({
          cliError: new UnexpectedError(new TypeError('boom')),
          commandName: 'whoami',
          durationMs: 10,
        }),
      ).resolves.toBeUndefined();

      expect(fakeFetch).toHaveBeenCalledTimes(2);
      expect(consoleError).not.toHaveBeenCalled();
      expect(stderrWrite).not.toHaveBeenCalled();
    });

    it('should stop waiting after 1.5 seconds when a request never answers', async () => {
      fakeFetch.mockImplementation(
        () => new Promise<Response>(() => undefined),
      );
      const startedAt = performance.now();

      await reportFinishedCommand({
        cliError: undefined,
        commandName: 'whoami',
        durationMs: 10,
      });

      const waitedMs = performance.now() - startedAt;
      expect(waitedMs).toBeGreaterThanOrEqual(1400);
      expect(waitedMs).toBeLessThan(2500);
    });
  });

  describe('resolveScrubbedStack', () => {
    it('should keep the frames without the message, each file cut to below node_modules or to its name', () => {
      expect(resolveScrubbedStack(STACK)).toBe(SCRUBBED_STACK);
    });
  });

  describe('printTelemetryNotice', () => {
    it('should print the notice once on stderr and remember it in config.json', () => {
      const stderrWrite = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      writeUserConfig({ apiUrl: 'https://api.example.com' });

      printTelemetryNotice();
      printTelemetryNotice();

      expect(stderrWrite.mock.calls).toEqual([[TELEMETRY_NOTICE]]);
      expect(readUserConfig()).toEqual({
        apiUrl: 'https://api.example.com',
        telemetryNoticeShownAt: expect.any(String),
      });
    });

    it('should print nothing when telemetry is switched off', () => {
      vi.stubEnv('DO_NOT_TRACK', '1');
      const stderrWrite = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      printTelemetryNotice();

      expect(stderrWrite).not.toHaveBeenCalled();
    });
  });
});
