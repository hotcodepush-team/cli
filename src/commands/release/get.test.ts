import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  DEMO_APP,
  FLEET,
  LIVE_RELEASE,
  PREVIOUS_RELEASE,
  PRODUCTION_CHANNEL,
  PROGRESSING_RELEASE,
  READY_BUNDLE,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import {
  CHANNEL_PATH,
  FLEET_PATH,
  LIVE_RELEASE_WITH_RELATIONS,
  readReleaseRelations,
  RELEASE_COUNTERS,
  respondWithRelease,
  respondWithStagingReleases,
} from '../../../test/release-routes.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { select } from '../../utils/prompt-renderers.js';
import releaseGetCommand from './get.js';

vi.mock('../../utils/prompt-renderers.js', () =>
  import('../../../test/prompt-renderers.js').then(
    ({ promptRenderersMock }) => promptRenderersMock,
  ),
);

describe('release get', () => {
  const harness = useCommandHarness();

  async function readProgressionLines(release: object): Promise<string[]> {
    respondWithStagingReleases(harness);
    respondWithRelease(harness, { ...LIVE_RELEASE_WITH_RELATIONS, ...release });
    await releaseGetCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        release: LIVE_RELEASE.id,
      },
      undefined,
    );
    return harness.readLines().filter(line => line.startsWith('Progression'));
  }

  it("should find the release by its number in the channel log and print it with its counters and its channel's auto-pause policy", async () => {
    respondWithStagingReleases(harness);

    await releaseGetCommand.action(
      {
        config: harness.writeProjectConfig({
          appId: DEMO_APP.id,
          channel: STAGING_CHANNEL.name,
        }),
        release: '43',
      },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID                            ${LIVE_RELEASE.id}`,
      'Number                        #43',
      'Channel                       staging',
      `Bundle                        #17 · 1.4.2 (${READY_BUNDLE.id})`,
      'Status                        active',
      'Rollout                       100%',
      'Progression                   none',
      'Failure threshold             10% (channel)',
      'Failure minimum update count  20 (channel)',
      'Failure action                pause (channel)',
      'Mandatory                     no',
      'Notes                         cart fix',
      'Rolled back from              nothing',
      `Live                          ${LIVE_RELEASE.liveAt}`,
      'Devices                       80',
      'Applied                       100',
      'Confirmed                     90',
      'Download failures             3',
      'Verification failures         1',
      'Crash failures                2',
      'Readiness timeout failures    1',
      'Reported failures             3',
      `Created                       ${LIVE_RELEASE.createdAt}`,
    ]);
    const fleetUrl = harness.requests
      .map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === FLEET_PATH);
    expect(fleetUrl?.searchParams.get('channelId')).toBe(STAGING_CHANNEL.id);
  });

  it('should print no devices when the fleet counts none on the release', async () => {
    respondWithStagingReleases(harness);
    harness.routes[`GET ${FLEET_PATH}`] = () =>
      Response.json({ ...FLEET, release: [] });

    await releaseGetCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        release: LIVE_RELEASE.id,
      },
      undefined,
    );

    expect(harness.readLines()).toContain('Devices                       0');
  });

  it('should print the release named by its id as JSON without reading the log', async () => {
    respondWithStagingReleases(harness);

    await releaseGetCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        json: true,
        release: LIVE_RELEASE.id,
      },
      undefined,
    );

    expect(
      harness.requests.filter(({ url }) => url.includes('/channels/')),
    ).toHaveLength(1);
    expect(harness.readJson()).toEqual({
      ...LIVE_RELEASE,
      bundle: READY_BUNDLE,
      releaseCounters: RELEASE_COUNTERS,
    });
  });

  it("should offer a picker over the channel's releases, each named by its bundle, when the release is missing and someone can pick", async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue(LIVE_RELEASE.id);
    respondWithStagingReleases(harness);

    await releaseGetCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.id },
      undefined,
    );

    expect(select).toHaveBeenCalledWith({
      message: 'Which release?',
      options: [
        { label: '#43 · #17 · 1.4.2 (active)', value: LIVE_RELEASE.id },
        { label: '#42 · #16 · 1.4.1 (active)', value: PREVIOUS_RELEASE.id },
      ],
    });
  });

  it('should refuse a release of another channel', async () => {
    respondWithStagingReleases(harness);
    respondWithRelease(harness, {
      ...LIVE_RELEASE_WITH_RELATIONS,
      channel: PRODUCTION_CHANNEL,
      channelId: PRODUCTION_CHANNEL.id,
    });

    await expect(
      releaseGetCommand.action(
        {
          app: DEMO_APP.id,
          channel: STAGING_CHANNEL.id,
          release: LIVE_RELEASE.id,
        },
        undefined,
      ),
    ).rejects.toBeInstanceOf(InvalidParameterError);
  });

  it('should refuse a number the channel has no release for, after one read', async () => {
    respondWithStagingReleases(harness);

    await expect(
      releaseGetCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, release: '99' },
        undefined,
      ),
    ).rejects.toThrow('The channel has no release "99" from --release.');
    expect(readReleaseRelations(harness)).toHaveLength(1);
  });

  it('should refuse a reference that is neither a number nor an id, before any read of a release', async () => {
    respondWithStagingReleases(harness);

    await expect(
      releaseGetCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, release: 'latest' },
        undefined,
      ),
    ).rejects.toThrow('The channel has no release "latest" from --release.');
    expect(readReleaseRelations(harness)).toEqual([]);
  });

  it("should print the release's own auto-pause values plain", async () => {
    respondWithStagingReleases(harness);
    respondWithRelease(harness, {
      ...LIVE_RELEASE_WITH_RELATIONS,
      failureAction: 'revoke',
      failureMinimumUpdateCount: 20,
      failureThresholdPercent: 10,
    });

    await releaseGetCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        release: LIVE_RELEASE.id,
      },
      undefined,
    );

    expect(
      harness.readLines().filter(line => line.startsWith('Failure')),
    ).toEqual([
      'Failure threshold             10%',
      'Failure minimum update count  20',
      'Failure action                revoke',
    ]);
  });

  it('should print the default with its level when neither the release nor its channel sets an auto-pause field', async () => {
    respondWithStagingReleases(harness);
    harness.routes[`GET ${CHANNEL_PATH}`] = () =>
      Response.json({
        ...STAGING_CHANNEL,
        failureAction: null,
        failureMinimumUpdateCount: null,
        failureThresholdPercent: null,
      });

    await releaseGetCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        release: LIVE_RELEASE.id,
      },
      undefined,
    );

    expect(
      harness.readLines().filter(line => line.startsWith('Failure')),
    ).toEqual([
      'Failure threshold             5% (default)',
      'Failure minimum update count  50 (default)',
      'Failure action                pause (default)',
    ]);
  });

  it('should print the schedule and the step reached with the sample its widening waits on', async () => {
    expect(await readProgressionLines(PROGRESSING_RELEASE)).toEqual([
      'Progression                   10, 50, 100 percent, each step at least 3600 seconds and 50 applied updates',
      'Progression step              1 of 3, Waiting on updates: 12 of 50 applied',
    ]);
  });

  it('should print the time the widening waits for when the sample is met', async () => {
    expect(
      await readProgressionLines({
        ...PROGRESSING_RELEASE,
        rolloutPercent: 50,
        stepStartAppliedUpdateCount: 50,
      }),
    ).toEqual([
      'Progression                   10, 50, 100 percent, each step at least 3600 seconds and 50 applied updates',
      'Progression step              2 of 3, ready at 2026-09-07T09:00:05.000Z',
    ]);
  });

  it('should print the schedule as complete when the release reached its last step', async () => {
    expect(
      await readProgressionLines({
        ...PROGRESSING_RELEASE,
        rolloutPercent: 100,
      }),
    ).toContain('Progression step              complete');
  });

  it('should print the schedule as held when the release is paused', async () => {
    expect(
      await readProgressionLines({
        ...PROGRESSING_RELEASE,
        pausedAt: '2026-09-07T08:30:00.000Z',
        status: 'paused',
      }),
    ).toContain('Progression step              held while paused');
  });
});
