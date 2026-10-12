import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  DEVICE,
  LIVE_RELEASE,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import deviceGetCommand from './get.js';

const DEVICE_PATH = `/v1/apps/${DEMO_APP.id}/devices/${DEVICE.deviceId}`;

const DEVICE_WITH_CHANNEL = {
  ...DEVICE,
  channel: STAGING_CHANNEL,
  currentReleaseId: LIVE_RELEASE.id,
};

const MARKS = [
  {
    createdAt: '2026-09-08T07:00:00.000Z',
    deviceId: DEVICE.deviceId,
    kind: 'failed' as const,
    reason: 'READINESS_TIMED_OUT',
    releaseId: LIVE_RELEASE.id,
    updatedAt: '2026-09-08T07:00:00.000Z',
  },
];

describe('device get', () => {
  const harness = useCommandHarness();

  function respondWithDeviceAndMarks(): void {
    harness.routes[`GET ${DEVICE_PATH}`] = () =>
      Response.json(DEVICE_WITH_CHANNEL);
    harness.routes[`GET ${DEVICE_PATH}/marks`] = () => Response.json(MARKS);
  }

  it('should print what the device runs and its last outcomes', async () => {
    respondWithDeviceAndMarks();

    await deviceGetCommand.action(
      { app: DEMO_APP.id, device: DEVICE.deviceId },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID           ${DEVICE.deviceId}`,
      'Platform     ios 17.4',
      'Binary       2.4.1 (57)',
      'Fingerprint  none',
      'Channel      staging (config)',
      `Release      ${LIVE_RELEASE.id}`,
      'SDK          0.1.0',
      'Attributes   tier=beta',
      'Country      DE',
      `Last seen    ${DEVICE.lastSeenAt}`,
      `First seen   ${DEVICE.createdAt}`,
      'RELEASE                               OUTCOME  REASON               DATE',
      `${LIVE_RELEASE.id}  failed   READINESS_TIMED_OUT  2026-09-08`,
    ]);
  });

  it('should print the device with its marks as JSON', async () => {
    respondWithDeviceAndMarks();

    await deviceGetCommand.action(
      { app: DEMO_APP.id, device: DEVICE.deviceId, json: true },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      ...DEVICE_WITH_CHANNEL,
      marks: MARKS,
    });
  });

  it('should fail with E_MISSING_PARAMETER naming --device when nobody can answer', async () => {
    await expect(
      deviceGetCommand.action({ app: DEMO_APP.id }, undefined),
    ).rejects.toMatchObject({ code: 'E_MISSING_PARAMETER' });
  });
});
