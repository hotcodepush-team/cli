import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  LIVE_RELEASE,
  PRODUCTION_CHANNEL,
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

  it('should find the release by its number in the channel log and print it with its counters', async () => {
    respondWithStagingReleases(harness);

    await releaseGetCommand.action(
      {
        config: harness.writeProjectConfig({
          appId: DEMO_APP.id,
          channelId: STAGING_CHANNEL.id,
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
      'Mandatory             no',
      'Notes                 cart fix',
      'Rolled back from      nothing',
      `Live                  ${LIVE_RELEASE.liveAt}`,
      'Devices               80',
      'Attempted             100',
      'Installed             90',
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
});
