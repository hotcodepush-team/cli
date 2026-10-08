import type {
  FleetStatistics,
  UpdateStatistics,
  UsageStatistics,
} from '@hotcodepush/node';
import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  LIVE_RELEASE,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import { respondWithChannels } from '../../../test/release-routes.js';
import statisticsGetCommand from './get.js';

const STATISTICS_PATH = `/v1/apps/${DEMO_APP.id}/statistics`;

const FLEET_STATISTICS: FleetStatistics = {
  binaryVersion: [{ count: 70, value: '2.4.1' }],
  country: [{ count: 70, value: 'DE' }],
  osVersion: [{ count: 70, platform: 'ios', value: '17.4' }],
  platform: [{ count: 70, value: 'ios' }],
  release: [
    {
      channelId: STAGING_CHANNEL.id,
      count: 50,
      number: 43,
      value: LIVE_RELEASE.id,
    },
    { channelId: null, count: 20, number: null, value: null },
  ],
  sdkVersion: [{ count: 70, value: '0.1.0' }],
};

const UPDATE_STATISTICS: UpdateStatistics = {
  days: [
    {
      activeDevices: 70,
      applied: 9,
      day: '2026-09-01',
      failed: 1,
      rolledBack: 0,
    },
  ],
  failureReasons: [{ count: 1, reason: 'READINESS_TIMED_OUT' }],
  releases: [
    {
      adoption: [{ applied: 9, at: '2026-09-01T08:00:00.000Z' }],
      channelId: STAGING_CHANNEL.id,
      liveAt: '2026-09-01T07:00:00.000Z',
      number: 43,
      releaseId: LIVE_RELEASE.id,
      timeToAdoption: {
        percent50At: '2026-09-01T08:00:00.000Z',
        percent90At: null,
      },
    },
  ],
  skippedReasons: [],
};

const USAGE_STATISTICS: UsageStatistics = {
  days: [{ bytes: 2048, checks: 40, day: '2026-09-01', downloadedBytes: 1024 }],
  months: [{ bytes: 2048, mau: 12, month: '2026-09-01' }],
};

describe('statistics get', () => {
  const harness = useCommandHarness();

  function readRequestUrl(path: string): URL | undefined {
    return harness.requests
      .map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === path);
  }

  it("should print the fleet of one channel per dimension, the embedded bundles' devices as embedded", async () => {
    respondWithChannels(harness);
    harness.routes[`GET ${STATISTICS_PATH}/fleet`] = () =>
      Response.json(FLEET_STATISTICS);

    await statisticsGetCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.name, type: 'fleet' },
      undefined,
    );

    expect(
      readRequestUrl(`${STATISTICS_PATH}/fleet`)?.searchParams.get('channelId'),
    ).toBe(STAGING_CHANNEL.id);
    expect(harness.readLines()).toEqual([
      'RELEASE                               DEVICES',
      `${LIVE_RELEASE.id}  50`,
      'embedded                              20',
      'BINARY VERSION  DEVICES',
      '2.4.1           70',
      'SDK VERSION  DEVICES',
      '0.1.0        70',
      'PLATFORM  DEVICES',
      'ios       70',
      'OS VERSION  DEVICES',
      '17.4        70',
      'COUNTRY  DEVICES',
      'DE       70',
    ]);
  });

  it('should print the updates of the period, inclusive, per day, per release and per reason', async () => {
    harness.routes[`GET ${STATISTICS_PATH}/updates`] = () =>
      Response.json(UPDATE_STATISTICS);

    await statisticsGetCommand.action(
      {
        app: DEMO_APP.id,
        periodSince: '2026-09-01',
        periodUntil: '2026-09-30',
        type: 'updates',
      },
      undefined,
    );

    expect(
      Object.fromEntries(
        readRequestUrl(`${STATISTICS_PATH}/updates`)?.searchParams ?? [],
      ),
    ).toEqual({ periodSince: '2026-09-01', periodUntil: '2026-09-30' });
    expect(harness.readLines()).toEqual([
      'DAY         APPLIED  FAILED  ROLLED BACK',
      '2026-09-01  9        1       0',
      'RELEASE  LIVE                      APPLIED  50% AT                    90% AT',
      '#43      2026-09-01T07:00:00.000Z  9        2026-09-01T08:00:00.000Z  not yet',
      'FAILURE REASON       COUNT',
      'READINESS_TIMED_OUT  1',
      'SKIP REASON: none in the period.',
    ]);
  });

  it('should print the usage as JSON', async () => {
    harness.routes[`GET ${STATISTICS_PATH}/usage`] = () =>
      Response.json(USAGE_STATISTICS);

    await statisticsGetCommand.action(
      { app: DEMO_APP.id, json: true, type: 'usage' },
      undefined,
    );

    expect(harness.readJson()).toEqual(USAGE_STATISTICS);
  });

  it('should print the months and the days of the usage', async () => {
    harness.routes[`GET ${STATISTICS_PATH}/usage`] = () =>
      Response.json(USAGE_STATISTICS);

    await statisticsGetCommand.action(
      { app: DEMO_APP.id, type: 'usage' },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      'MONTH    MAU  BYTES',
      '2026-09  12   2.0 kB',
      'DAY         CHECKS  BYTES   DOWNLOADED',
      '2026-09-01  40      2.0 kB  1.0 kB',
    ]);
  });

  it('should refuse a period on the fleet, a snapshot without one', async () => {
    await expect(
      statisticsGetCommand.action(
        { app: DEMO_APP.id, periodSince: '2026-09-01', type: 'fleet' },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'E_INVALID_PARAMETER' });
    expect(harness.requests).toEqual([]);
  });

  it('should refuse a channel on the usage, which counts the whole app', async () => {
    await expect(
      statisticsGetCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.name, type: 'usage' },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'E_INVALID_PARAMETER' });
    expect(harness.requests).toEqual([]);
  });

  it('should fail with E_MISSING_PARAMETER naming --type when nobody can pick one', async () => {
    await expect(
      statisticsGetCommand.action({ app: DEMO_APP.id }, undefined),
    ).rejects.toMatchObject({ code: 'E_MISSING_PARAMETER' });
  });
});
