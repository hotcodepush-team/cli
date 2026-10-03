import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { DEMO_APP, STAGING_CHANNEL } from '../../../test/fixtures.js';
import {
  CHANNEL_PATH,
  RELEASE_LOG,
  respondWithStagingReleases,
} from '../../../test/release-routes.js';
import releaseListCommand from './list.js';

describe('release list', () => {
  const harness = useCommandHarness();

  it('should print the release log of the project channel with the devices on each release', async () => {
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
      'NUMBER  BUNDLE       STATE   ROLLOUT  MANDATORY  DEVICES  LIVE        CREATED',
      '#43     #17 · 1.4.2  active  100%     no         80       2026-09-07  2026-09-07',
      '#42     #16 · 1.4.1  active  100%     no         20       2026-09-06  2026-09-06',
    ]);
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
});
