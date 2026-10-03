import { describe, expect, it, vi } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { DEMO_APP, DEVICE, STAGING_CHANNEL } from '../../../test/fixtures.js';
import { respondWithChannels } from '../../../test/release-routes.js';
import deviceListCommand from './list.js';

const DEVICES_PATH = `/v1/apps/${DEMO_APP.id}/devices`;

describe('device list', () => {
  const harness = useCommandHarness();

  function readListUrl(): URL | undefined {
    return harness.requests
      .map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === DEVICES_PATH);
  }

  it('should list the devices carrying an attribute with their binary, channel and last report', async () => {
    harness.routes[`GET ${DEVICES_PATH}`] = () =>
      Response.json([{ ...DEVICE, channel: STAGING_CHANNEL }]);

    await deviceListCommand.action(
      { app: DEMO_APP.id, attribute: 'userId=42' },
      undefined,
    );

    expect(readListUrl()?.searchParams.get('attribute')).toBe('userId=42');
    expect(harness.readLines()).toEqual([
      'ID                                    PLATFORM  BINARY      CHANNEL  SDK    LAST SEEN',
      `${DEVICE.id}  ios       2.4.1 (57)  staging  0.1.0  2026-09-08`,
    ]);
  });

  it('should send every filter, the channel by its id and a duration as the timestamp it reaches back to', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-10T12:00:00.000Z') });
    respondWithChannels(harness);
    harness.routes[`GET ${DEVICES_PATH}`] = () => Response.json([]);

    await deviceListCommand.action(
      {
        app: DEMO_APP.id,
        binaryBuild: '57',
        binaryVersion: '2.4.1',
        channel: STAGING_CHANNEL.name,
        fingerprint: 'fp1:abc',
        lastSeenSince: '2h',
        lastSeenUntil: '2026-09-10T00:00:00.000Z',
        platform: 'ios',
        runtimeVersion: '1.0.0',
        sdkVersion: '0.1.0',
      },
      undefined,
    );
    vi.useRealTimers();

    expect(Object.fromEntries(readListUrl()?.searchParams ?? [])).toEqual({
      binaryBuild: '57',
      binaryVersion: '2.4.1',
      channelId: STAGING_CHANNEL.id,
      fingerprint: 'fp1:abc',
      lastSeenSince: '2026-09-10T10:00:00.000Z',
      lastSeenUntil: '2026-09-10T00:00:00.000Z',
      platform: 'ios',
      relations: 'channel',
      runtimeVersion: '1.0.0',
      sdkVersion: '0.1.0',
    });
    expect(harness.readLines()).toEqual([
      'No devices match; a device appears with its first check.',
    ]);
  });

  it('should print JSON with the next offset', async () => {
    harness.routes[`GET ${DEVICES_PATH}`] = () => Response.json([DEVICE]);

    await deviceListCommand.action(
      { app: DEMO_APP.id, json: true, limit: 1 },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      devices: [DEVICE],
      nextOffset: 1,
    });
  });
});
