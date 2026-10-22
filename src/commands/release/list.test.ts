import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  FLEET,
  PROGRESSING_RELEASE,
  READY_BUNDLE,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import {
  CHANNEL_PATH,
  FLEET_PATH,
  RELEASE_COUNTERS,
  RELEASE_LOG,
  respondWithStagingReleases,
} from '../../../test/release-routes.js';
import releaseListCommand from './list.js';

describe('release list', () => {
  const harness = useCommandHarness();

  it("should print the release log of the project channel with the devices the channel's fleet counts on each release", async () => {
    respondWithStagingReleases(harness);

    await releaseListCommand.action(
      {
        config: harness.writeProjectConfig({
          appId: DEMO_APP.id,
          channel: STAGING_CHANNEL.name,
        }),
      },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      'NUMBER  BUNDLE       STATUS  ROLLOUT  PROGRESSION  MANDATORY  DEVICES  LIVE        CREATED',
      '#43     #17 · 1.4.2  active  100%     none         no         80       2026-09-07  2026-09-07',
      '#42     #16 · 1.4.1  active  100%     none         no         20       2026-09-06  2026-09-06',
    ]);
    const fleetUrl = harness.requests
      .map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === FLEET_PATH);
    expect(fleetUrl?.searchParams.get('channelId')).toBe(STAGING_CHANNEL.id);
  });

  it('should print no devices on a release the fleet has no bucket for', async () => {
    respondWithStagingReleases(harness);
    harness.routes[`GET ${FLEET_PATH}`] = () =>
      Response.json({ ...FLEET, release: [] });

    await releaseListCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.id },
      undefined,
    );

    expect(harness.readLines()[1]).toBe(
      '#43     #17 · 1.4.2  active  100%     none         no         0        2026-09-07  2026-09-07',
    );
  });

  it('should print the page as JSON with the next offset when --json and --limit are passed', async () => {
    respondWithStagingReleases(harness);
    harness.routes[`GET ${CHANNEL_PATH}/releases`] = () =>
      Response.json(RELEASE_LOG.slice(0, 1));

    await releaseListCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        json: true,
        limit: 1,
      },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      nextOffset: 1,
      releases: RELEASE_LOG.slice(0, 1),
    });
  });

  it('should print the schedule with the step reached and its gate when a release progresses', async () => {
    respondWithStagingReleases(harness);
    harness.routes[`GET ${CHANNEL_PATH}/releases`] = () =>
      Response.json([
        {
          ...PROGRESSING_RELEASE,
          bundle: READY_BUNDLE,
          releaseCounters: RELEASE_COUNTERS,
        },
      ]);

    await releaseListCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.id },
      undefined,
    );

    expect(
      harness.requests
        .map(({ url }) => new URL(url))
        .find(({ pathname }) => pathname === `${CHANNEL_PATH}/releases`)
        ?.searchParams.get('relations'),
    ).toBe('bundle,releaseCounters');
    expect(harness.readLines()[1]).toBe(
      '#43     #17 · 1.4.2  active  10%      10,50,100% · 1 of 3, waiting on sample: 12 of 50 applied  no         80       2026-09-07  2026-09-07',
    );
  });
});
