import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  DEMO_APP,
  LIVE_RELEASE,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import {
  RELEASES_PATH,
  respondWithStagingReleases,
} from '../../../test/release-routes.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import { MissingParameterError } from '../../utils/errors.js';
import releaseUpdateCommand from './update.js';

vi.mock('@clack/prompts');

describe('release update', () => {
  const harness = useCommandHarness();

  function readUpdateRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'PATCH');
  }

  function respondWithUpdatedRelease(): void {
    respondWithStagingReleases(harness);
    harness.routes[`PATCH ${RELEASES_PATH}/${LIVE_RELEASE.id}`] = () =>
      Response.json(LIVE_RELEASE);
  }

  it('should change the mandatory flag and the notes once confirmed with what changes', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithStagingReleases(harness);
    harness.routes[`PATCH ${RELEASES_PATH}/${LIVE_RELEASE.id}`] = () =>
      Response.json({ ...LIVE_RELEASE, isMandatory: true, notes: 'hotfix' });

    await releaseUpdateCommand.action(
      {
        config: harness.writeProjectConfig({
          appId: DEMO_APP.id,
          channel: STAGING_CHANNEL.name,
        }),
        mandatory: true,
        notes: 'hotfix',
        release: '43',
      },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This changes release #43 of staging, mandatory on and notes "hotfix": devices see the change on their next check. Continue?',
    });
    const [updateRequest] = readUpdateRequests();
    expect(await updateRequest?.json()).toEqual({
      isMandatory: true,
      notes: 'hotfix',
    });
    expect(harness.readLines()).toEqual([
      `Updated release #43 of staging (${LIVE_RELEASE.id}).`,
    ]);
  });

  it('should clear the mandatory flag with --mandatory false and print the release as JSON when --yes and --json are passed', async () => {
    respondWithStagingReleases(harness);
    harness.routes[`PATCH ${RELEASES_PATH}/${LIVE_RELEASE.id}`] = () =>
      Response.json(LIVE_RELEASE);

    await releaseUpdateCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        json: true,
        mandatory: false,
        release: LIVE_RELEASE.id,
        yes: true,
      },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    const [updateRequest] = readUpdateRequests();
    expect(await updateRequest?.json()).toEqual({ isMandatory: false });
    expect(harness.readJson()).toEqual(LIVE_RELEASE);
  });

  it('should refuse to run without a change to make', async () => {
    await expect(
      releaseUpdateCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, release: '43' },
        undefined,
      ),
    ).rejects.toBeInstanceOf(MissingParameterError);

    expect(harness.requests).toEqual([]);
  });

  it('should change the auto-pause overrides once confirmed with what changes', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithUpdatedRelease();

    await releaseUpdateCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        failureAction: 'revoke',
        failureMinimumUpdateCount: 20,
        failureThreshold: 10,
        release: '43',
      },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This changes release #43 of staging, failure threshold 10% and failure minimum update count 20 and failure action revoke: devices see the change on their next check. Continue?',
    });
    const [updateRequest] = readUpdateRequests();
    expect(await updateRequest?.json()).toEqual({
      failureAction: 'revoke',
      failureMinimumUpdateCount: 20,
      failureThresholdPercent: 10,
    });
  });

  it.each([
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
    ['--clear-notes', { clearNotes: true }, { notes: null }],
  ])(
    'should send null for the field %s clears and nothing else',
    async (_flag, clearOption, expectedBody) => {
      respondWithUpdatedRelease();

      await releaseUpdateCommand.action(
        {
          ...clearOption,
          app: DEMO_APP.id,
          channel: STAGING_CHANNEL.id,
          release: '43',
          yes: true,
        },
        undefined,
      );

      const [updateRequest] = readUpdateRequests();
      expect(await updateRequest?.json()).toEqual(expectedBody);
    },
  );

  it('should say a cleared field is cleared when confirming', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithUpdatedRelease();

    await releaseUpdateCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        clearFailureAction: true,
        clearNotes: true,
        release: '43',
      },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This changes release #43 of staging, failure action cleared and notes cleared: devices see the change on their next check. Continue?',
    });
  });

  it.each([
    ['failure-action', { clearFailureAction: true, failureAction: 'pause' }],
    [
      'failure-minimum-update-count',
      { clearFailureMinimumUpdateCount: true, failureMinimumUpdateCount: 20 },
    ],
    [
      'failure-threshold',
      { clearFailureThreshold: true, failureThreshold: 10 },
    ],
    ['notes', { clearNotes: true, notes: 'hotfix' }],
  ] as const)(
    'should refuse --%s together with its --clear- flag',
    async (flagName, options) => {
      await expect(
        releaseUpdateCommand.action(
          {
            ...options,
            app: DEMO_APP.id,
            channel: STAGING_CHANNEL.id,
            release: '43',
            yes: true,
          },
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

  it('should read a bare --clear-notes from the command line as the notes set to null', async () => {
    respondWithUpdatedRelease();

    const exitCode = await runCli(
      { 'release update': () => import('./update.js') },
      [
        'release',
        'update',
        '--app',
        DEMO_APP.id,
        '--channel',
        STAGING_CHANNEL.id,
        '--release',
        '43',
        '--clear-notes',
        '--yes',
      ],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(0);
    const [updateRequest] = readUpdateRequests();
    expect(await updateRequest?.json()).toEqual({ notes: null });
  });
});
