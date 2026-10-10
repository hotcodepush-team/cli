import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  LIVE_RELEASE,
  PRODUCTION_CHANNEL,
  PROGRESSING_RELEASE,
  READY_BUNDLE,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import {
  LIVE_RELEASE_WITH_RELATIONS,
  RELEASES_PATH,
  respondWithStagingReleases,
} from '../../../test/release-routes.js';
import { InvalidParameterError } from '../../utils/errors.js';
import releaseGetCommand from './get.js';

describe('release get', () => {
  const harness = useCommandHarness();

  async function readProgressionLines(release: object): Promise<string[]> {
    respondWithStagingReleases(harness);
    harness.routes[`GET ${RELEASES_PATH}/${LIVE_RELEASE.id}`] = () =>
      Response.json({ ...LIVE_RELEASE_WITH_RELATIONS, ...release });
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

  it('should find the release by its number in the channel log and print it with its counters', async () => {
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
      `ID                    ${LIVE_RELEASE.id}`,
      'Number                #43',
      'Channel               staging',
      `Bundle                #17 · 1.4.2 (${READY_BUNDLE.id})`,
      'State                 active',
      'Rollout               100%',
      'Progression           none',
      'Mandatory             no',
      'Notes                 cart fix',
      'Rolled back from      nothing',
      `Live                  ${LIVE_RELEASE.liveAt}`,
      'Devices               80',
      'Attempted             100',
      'Applied               90',
      'Failed download       3',
      'Failed verification   1',
      'Failed crashed        2',
      'Failed ready timeout  1',
      'Failed reported       3',
      `Created               ${LIVE_RELEASE.createdAt}`,
    ]);
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
    expect(harness.readJson()).toEqual(LIVE_RELEASE_WITH_RELATIONS);
  });

  it('should refuse a release of another channel', async () => {
    respondWithStagingReleases(harness);
    harness.routes[`GET ${RELEASES_PATH}/${LIVE_RELEASE.id}`] = () =>
      Response.json({
        ...LIVE_RELEASE_WITH_RELATIONS,
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

  it('should print the schedule and the step reached with the sample its widening waits on', async () => {
    expect(await readProgressionLines(PROGRESSING_RELEASE)).toEqual([
      'Progression           10, 50, 100 percent, each step at least 3600 seconds and 50 attempts',
      'Progression step      1 of 3, waiting on sample: 12 of 50 attempts',
    ]);
  });

  it('should print the time the widening waits for when the sample is met', async () => {
    expect(
      await readProgressionLines({
        ...PROGRESSING_RELEASE,
        progressionStep: {
          gate: { kind: 'time', readyAt: '2026-09-07T09:00:05.000Z' },
          number: 2,
        },
        rolloutPercentage: 50,
      }),
    ).toEqual([
      'Progression           10, 50, 100 percent, each step at least 3600 seconds and 50 attempts',
      'Progression step      2 of 3, ready at 2026-09-07T09:00:05.000Z',
    ]);
  });

  it('should print the schedule as complete when the release reached its last step', async () => {
    expect(
      await readProgressionLines({
        ...PROGRESSING_RELEASE,
        progressionStep: null,
        rolloutPercentage: 100,
      }),
    ).toContain('Progression step      complete');
  });

  it('should print the schedule as held when the release is paused', async () => {
    expect(
      await readProgressionLines({
        ...PROGRESSING_RELEASE,
        pausedAt: '2026-09-07T08:30:00.000Z',
        progressionStep: null,
        state: 'paused',
      }),
    ).toContain('Progression step      held while paused');
  });
});
