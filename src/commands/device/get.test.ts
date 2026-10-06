import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  DEVICE,
  LIVE_RELEASE,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import deviceGetCommand from './get.js';

const DEVICE_PATH = `/v1/apps/${DEMO_APP.id}/devices/${DEVICE.id}`;

const DEVICE_WITH_OUTCOMES = {
  ...DEVICE,
  channel: STAGING_CHANNEL,
  currentReleaseId: LIVE_RELEASE.id,
  marks: [
    {
      createdAt: '2026-09-08T07:00:00.000Z',
      kind: 'failed' as const,
      reason: 'READY_TIMEOUT',
      releaseId: LIVE_RELEASE.id,
      updatedAt: '2026-09-08T07:00:00.000Z',
    },
  ],
};

describe('device get', () => {
  const harness = useCommandHarness();

  it('should print what the device runs and its last outcomes', async () => {
    harness.routes[`GET ${DEVICE_PATH}`] = () =>
      Response.json(DEVICE_WITH_OUTCOMES);

    await deviceGetCommand.action(
      { app: DEMO_APP.id, device: DEVICE.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID           ${DEVICE.id}`,
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
      'RELEASE                               OUTCOME  REASON         DATE',
      `${LIVE_RELEASE.id}  failed   READY_TIMEOUT  2026-09-08`,
    ]);
  });

  it('should print the device as JSON', async () => {
    harness.routes[`GET ${DEVICE_PATH}`] = () =>
      Response.json(DEVICE_WITH_OUTCOMES);

    await deviceGetCommand.action(
      { app: DEMO_APP.id, device: DEVICE.id, json: true },
      undefined,
    );

    expect(harness.readJson()).toEqual(DEVICE_WITH_OUTCOMES);
  });

  it('should fail with E_MISSING_PARAMETER naming --device when nobody can answer', async () => {
    await expect(
      deviceGetCommand.action({ app: DEMO_APP.id }, undefined),
    ).rejects.toMatchObject({ code: 'E_MISSING_PARAMETER' });
  });
});
