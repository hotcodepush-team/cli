import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  STAGING_CHANNEL,
  STAGING_CHANNEL_WITH_DEVICE_COUNTS,
} from '../../../test/fixtures.js';
import { MissingParameterError } from '../../utils/errors.js';
import channelGetCommand from './get.js';

const OTHER_APP_ID = '3d594650-3436-4a7e-8f0c-2e6a3b1b7a51';

describe('channel get', () => {
  const harness = useCommandHarness();

  function respondWithChannel(): void {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/channels`] = () =>
      Response.json([STAGING_CHANNEL, PRODUCTION_CHANNEL]);
    harness.routes[
      `GET /v1/apps/${DEMO_APP.id}/channels/${STAGING_CHANNEL.id}`
    ] = () => Response.json(STAGING_CHANNEL_WITH_DEVICE_COUNTS);
  }

  it('should print the channel of hotcodepush.json with its device counts', async () => {
    respondWithChannel();

    await channelGetCommand.action(
      {
        config: harness.writeProjectConfig({
          appId: DEMO_APP.id,
          channelId: STAGING_CHANNEL.id,
        }),
      },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID                  ${STAGING_CHANNEL.id}`,
      'Name                staging',
      'State               running',
      'Protected           no',
      'Discoverable        no',
      'Expires             never',
      'Failure threshold   10%',
      'Failure min sample  20',
      'Failure action      pause',
      'Active devices      120',
      'Current devices     100',
      'Embedded devices    20',
      'Created             2026-09-04T08:00:00.000Z',
    ]);
  });

  it("should look --channel's name up among the app's channels and print the channel as JSON", async () => {
    respondWithChannel();

    await channelGetCommand.action(
      { app: DEMO_APP.id, channel: 'STAGING', json: true },
      undefined,
    );

    expect(harness.readJson()).toEqual(STAGING_CHANNEL_WITH_DEVICE_COUNTS);
  });

  it.each([
    ['appId', { appId: 'x & calc', channelId: STAGING_CHANNEL.id }],
    ['channelId', { appId: DEMO_APP.id, channelId: '../bundles' }],
  ])(
    'should refuse a hotcodepush.json %s that is no id before asking the API',
    async (field, projectConfig) => {
      await expect(
        channelGetCommand.action(
          { config: harness.writeProjectConfig(projectConfig) },
          undefined,
        ),
      ).rejects.toMatchObject({
        code: 'E_INVALID_PARAMETER',
        message: `hotcodepush.json: ${field} is no id`,
      });
      expect(harness.requests).toEqual([]);
    },
  );

  it("should not take hotcodepush.json's channel for another app", async () => {
    await expect(
      channelGetCommand.action(
        {
          app: OTHER_APP_ID,
          config: harness.writeProjectConfig({
            appId: DEMO_APP.id,
            channelId: STAGING_CHANNEL.id,
          }),
        },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--channel'));
  });

  it("should throw the API's E_NOT_FOUND when no channel has the id", async () => {
    await expect(
      channelGetCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'E_NOT_FOUND', status: 404 });
  });
});
