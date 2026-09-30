import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  STAGING_CHANNEL,
  STAGING_CHANNEL_WITH_DEVICE_COUNTS,
} from '../../../test/fixtures.js';
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
});
