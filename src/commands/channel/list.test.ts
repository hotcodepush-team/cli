import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../testing/command-harness.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  STAGING_CHANNEL,
} from '../../testing/fixtures.js';
import channelListCommand from './list.js';

describe('channel list', () => {
  const harness = useCommandHarness();

  it("should print the app's channels as a table with their state", async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/channels`] = () =>
      Response.json([
        { ...STAGING_CHANNEL, pausedAt: '2026-09-05T08:00:00.000Z' },
        PRODUCTION_CHANNEL,
      ]);

    await channelListCommand.action({ app: DEMO_APP.id }, undefined);

    expect(harness.readLines()).toEqual([
      'ID                                    NAME        STATE    CREATED',
      `${STAGING_CHANNEL.id}  staging     paused   2026-09-04`,
      `${PRODUCTION_CHANNEL.id}  production  running  2026-09-03`,
    ]);
  });

  it('should print the channels and the next offset as JSON when --json is passed', async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/channels?limit=2&offset=4`] =
      () => Response.json([STAGING_CHANNEL, PRODUCTION_CHANNEL]);

    await channelListCommand.action(
      { app: DEMO_APP.id, json: true, limit: 2, offset: 4 },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      channels: [STAGING_CHANNEL, PRODUCTION_CHANNEL],
      nextOffset: 6,
    });
  });
});
