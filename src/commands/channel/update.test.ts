import { describe, expect, it, vi } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  STAGING_CHANNEL,
  STAGING_CHANNEL_WITH_DEVICE_COUNTS,
} from '../../../test/fixtures.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import channelUpdateCommand from './update.js';

const CHANNEL_PATH = `/v1/apps/${DEMO_APP.id}/channels/${STAGING_CHANNEL.id}`;

describe('channel update', () => {
  const harness = useCommandHarness();

  function respondWithChannel(): void {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/channels`] = () =>
      Response.json([STAGING_CHANNEL, PRODUCTION_CHANNEL]);
    harness.routes[`GET ${CHANNEL_PATH}`] = () =>
      Response.json(STAGING_CHANNEL_WITH_DEVICE_COUNTS);
    harness.routes[`PATCH ${CHANNEL_PATH}`] = () =>
      Response.json({ ...STAGING_CHANNEL, name: 'beta' });
  }

  it('should send only the fields the flags name and print the new name', async () => {
    respondWithChannel();

    await channelUpdateCommand.action(
      {
        app: DEMO_APP.id,
        channel: 'staging',
        failureAction: 'notify',
        name: 'beta',
        protected: true,
      },
      undefined,
    );

    expect(await harness.requests.at(-1)?.json()).toEqual({
      failureAction: 'notify',
      isProtected: true,
      name: 'beta',
    });
    expect(harness.readLines()).toEqual([
      `Updated channel beta (${STAGING_CHANNEL.id}).`,
    ]);
  });

  it('should print the channel as JSON when --json is passed', async () => {
    respondWithChannel();

    await channelUpdateCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        expiresAt: '2026-10-13T12:00:00.000Z',
        json: true,
      },
      undefined,
    );

    expect(await harness.requests.at(-1)?.json()).toEqual({
      expiresAt: '2026-10-13T12:00:00.000Z',
    });
    expect(harness.readJson()).toEqual({ ...STAGING_CHANNEL, name: 'beta' });
  });

  it.each([
    ['--clear-expires-at', { clearExpiresAt: true }, { expiresAt: null }],
    [
      '--clear-failure-action',
      { clearFailureAction: true },
      { failureAction: null },
    ],
    [
      '--clear-failure-minimum-update-count',
      { clearFailureMinimumUpdateCount: true },
      { failureMinimumUpdateCount: null },
    ],
    [
      '--clear-failure-threshold',
      { clearFailureThreshold: true },
      { failureThresholdPercent: null },
    ],
  ])(
    'should send null for the field %s clears and nothing else',
    async (_flag, clearOption, expectedBody) => {
      respondWithChannel();

      await channelUpdateCommand.action(
        { ...clearOption, app: DEMO_APP.id, channel: STAGING_CHANNEL.id },
        undefined,
      );

      expect(await harness.requests.at(-1)?.json()).toEqual(expectedBody);
    },
  );

  it.each([
    [
      'expires-at',
      { clearExpiresAt: true, expiresAt: '2026-10-13T12:00:00.000Z' },
    ],
    ['failure-action', { clearFailureAction: true, failureAction: 'pause' }],
    [
      'failure-minimum-update-count',
      { clearFailureMinimumUpdateCount: true, failureMinimumUpdateCount: 20 },
    ],
    [
      'failure-threshold',
      { clearFailureThreshold: true, failureThreshold: 10 },
    ],
  ] as const)(
    'should refuse --%s together with its --clear- flag',
    async (flagName, options) => {
      await expect(
        channelUpdateCommand.action(
          { ...options, app: DEMO_APP.id, channel: STAGING_CHANNEL.id },
          undefined,
        ),
      ).rejects.toMatchObject({
        code: 'E_INVALID_PARAMETER',
        fix: 'Pass only one of them.',
        message: `The flags --${flagName} and --clear-${flagName} were passed together.`,
      });
      expect(harness.requests).toEqual([]);
    },
  );

  it('should refuse --clear-expires-at together with --expires-in', async () => {
    await expect(
      channelUpdateCommand.action(
        {
          app: DEMO_APP.id,
          channel: STAGING_CHANNEL.id,
          clearExpiresAt: true,
          expiresIn: '7d',
        },
        undefined,
      ),
    ).rejects.toMatchObject({
      code: 'E_INVALID_PARAMETER',
      fix: 'Pass only one of them.',
      message:
        'The flags --expires-in and --clear-expires-at were passed together.',
    });
    expect(harness.requests).toEqual([]);
  });

  it('should refuse a --failure-threshold that is no whole number', async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    const exitCode = await runCli(
      { 'channel update': () => import('./update.js') },
      [
        'channel',
        'update',
        '--app',
        DEMO_APP.id,
        '--channel',
        STAGING_CHANNEL.id,
        '--failure-threshold',
        '12.5',
      ],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(2);
    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('The value of --failure-threshold is invalid.'),
    );
    expect(harness.requests).toEqual([]);
  });
});
