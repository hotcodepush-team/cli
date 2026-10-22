import { select } from '@clack/prompts';
import type { Binary, Device } from '@hotcodepush/node';
import type { ChannelIndex } from '@hotcodepush/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_URL,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  BINARY,
  DEMO_APP,
  DEVICE,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import type { EvaluationFixture } from '../../../test/protocol-fixtures.js';
import { readEvaluationFixtures } from '../../../test/protocol-fixtures.js';
import {
  CHANNEL_PATH,
  respondWithChannels,
} from '../../../test/release-routes.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import deviceProbeCommand from './probe.js';

vi.mock('@clack/prompts');

const BINARIES_PATH = `/v1/apps/${DEMO_APP.id}/binaries`;

const FINGERPRINT = `fp1:${'a'.repeat(64)}`;

const INDEX_PATH = `/files/apps/${DEMO_APP.id}/channels/${STAGING_CHANNEL.id}/ios/v1/index.json`;

const INDEX_PUBLISHED_AT = '2026-09-07T08:00:00.123Z';

const PROBED_BINARY: Binary = {
  ...BINARY,
  build: '57',
  createdAt: '2026-09-01T00:00:00.000Z',
  fingerprint: FINGERPRINT,
  version: '2.4.1',
};

const RELEASE = {
  bundleId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
  bundleVersion: '1.4.2',
  conditions: [],
  createdAt: '2026-09-07T08:00:00.000Z',
  id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  isMandatory: false,
  manifestSha256: '0'.repeat(64),
  manifestUrl: `${API_URL}/files/apps/${DEMO_APP.id}/bundles/c56a4180-65aa-42ec-a945-5fd21dec0538/manifest.json`,
  notes: null,
  number: 43,
  rolloutPercentage: 100,
  sizeBytes: 1000,
};

const INDEX: ChannelIndex = {
  appId: DEMO_APP.id,
  cappedAt: null,
  channelId: STAGING_CHANNEL.id,
  isPaused: false,
  platform: 'ios',
  releases: [
    {
      ...RELEASE,
      conditions: [
        { range: '>=2.0.0', type: 'binary' },
        { fingerprint: FINGERPRINT, type: 'fingerprint' },
        { range: '>=99', type: 'os' },
      ],
      rolloutPercentage: 0,
    },
  ],
  revokedReleaseIds: [],
  schema: 1,
  sequence: Date.parse(INDEX_PUBLISHED_AT),
};

/**
 * The evaluation cases a device's record and a store build's binary carry every fact of: a device on its embedded
 * bundle that never failed a bundle, under no spending cap.
 */
const DEVICE_FIXTURES = [
  'conditions-attribute',
  'conditions-binary',
  'conditions-device',
  'conditions-fingerprint',
  'conditions-os',
  'conditions-unknown',
  'floor',
  'rollout',
]
  .flatMap(readEvaluationFixtures)
  .filter(
    ({ device, index }) =>
      device.currentRelease === null &&
      device.failedBundleIds.length === 0 &&
      index.cappedAt === null,
  );

describe('device probe', () => {
  const harness = useCommandHarness();

  beforeEach(() => {
    respondWithChannels(harness);
    harness.routes[`GET ${CHANNEL_PATH}`] = () =>
      Response.json(STAGING_CHANNEL);
    harness.routes[`GET ${BINARIES_PATH}`] = () =>
      Response.json([PROBED_BINARY]);
    respondWithIndex(INDEX);
  });

  function respondWithOrganizationApps(): void {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION]);
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}/apps`] = () =>
      Response.json([DEMO_APP]);
  }

  function respondWithIndex(servedIndex: ChannelIndex): void {
    harness.routes[`GET ${INDEX_PATH}`] = () => Response.json(servedIndex);
  }

  it.each(DEVICE_FIXTURES.map(fixture => [fixture.name, fixture]))(
    "should yield the protocol's outcome for the facts of the device's record: %s",
    async (_name, fixture: EvaluationFixture) => {
      const fetchedDevice: Device = {
        ...DEVICE,
        attributes: fixture.device.attributes,
        binaryBuild: fixture.device.binaryBuild,
        binaryVersion: fixture.device.binaryVersion,
        deviceId: fixture.device.deviceId,
        fingerprint: fixture.device.fingerprint,
        osVersion: fixture.device.osVersion,
        platform: 'ios',
      };
      harness.routes[
        `GET /v1/apps/${DEMO_APP.id}/devices/${fetchedDevice.deviceId}`
      ] = () => Response.json(fetchedDevice);
      harness.routes[
        `GET /v1/apps/${DEMO_APP.id}/devices/${fetchedDevice.deviceId}/events`
      ] = () => Response.json([]);
      harness.routes[`GET ${BINARIES_PATH}`] = () =>
        Response.json([
          {
            ...PROBED_BINARY,
            build: fixture.device.binaryBuild,
            createdAt: fixture.device.builtAt,
            version: fixture.device.binaryVersion,
          },
        ]);
      respondWithIndex({ ...fixture.index, platform: 'ios' });

      await deviceProbeCommand.action(
        { app: DEMO_APP.id, device: fetchedDevice.deviceId, json: true },
        undefined,
      );

      const { outcome, unknownFacts } = harness.readJson() as {
        outcome: {
          condition?: string;
          isMandatory?: boolean;
          reason?: string;
          release: { id: string } | null;
          status: string;
        };
        unknownFacts: string[];
      };
      expect(unknownFacts).toEqual([]);
      expect({
        condition: outcome.condition,
        isMandatory: outcome.isMandatory,
        reason: outcome.reason,
        releaseId: outcome.release?.id ?? null,
        status: outcome.status,
      }).toEqual({
        condition: fixture.expected.condition,
        isMandatory: fixture.expected.isMandatory,
        reason: fixture.expected.reason,
        releaseId: fixture.expected.releaseId,
        status: fixture.expected.status,
      });
    },
  );

  it("should run the debugging guide's command as written, with the fingerprint of the store build's binary and the unknown facts passing", async () => {
    const configPath = harness.writeProjectConfig({
      appId: DEMO_APP.id,
      channel: STAGING_CHANNEL.name,
    });
    vi.spyOn(process, 'cwd').mockReturnValue(
      configPath.slice(0, -'/hotcodepush.json'.length),
    );

    const exitCode = await runCli(
      { 'device probe': () => import('./probe.js') },
      [
        'device',
        'probe',
        '--platform',
        'ios',
        '--binary-version',
        '2.4.1',
        '--binary-build',
        '57',
      ],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(0);
    expect(harness.readLines()).toEqual([
      'Channel  staging, ios',
      `Index    published ${INDEX_PUBLISHED_AT}`,
      'Outcome  AVAILABLE, release #43',
      'Unknown  os, rollout, treated as passing; pass --device for the facts of a real device',
      'RELEASE  ROLLOUT  CONDITIONS                                 VERDICT',
      '#43      0%       binary pass, fingerprint pass, os unknown  eligible',
    ]);
  });

  it('should mark the fingerprint unknown when no binary was created with the identity', async () => {
    harness.routes[`GET ${BINARIES_PATH}`] = () => Response.json([]);

    await deviceProbeCommand.action(
      {
        app: DEMO_APP.id,
        binaryBuild: '57',
        binaryVersion: '2.4.1',
        channel: STAGING_CHANNEL.id,
        json: true,
        platform: 'ios',
      },
      undefined,
    );

    const json = harness.readJson() as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual([
      'channelId',
      'device',
      'outcome',
      'platform',
      'sequence',
      'status',
      'unknownFacts',
      'url',
      'verdicts',
    ]);
    expect(json).toMatchObject({
      device: { builtAt: null, fingerprint: null },
      outcome: { release: { id: RELEASE.id }, status: 'AVAILABLE' },
      sequence: Date.parse(INDEX_PUBLISHED_AT),
      status: 200,
      unknownFacts: ['fingerprint', 'os', 'rollout'],
      url: `${API_URL}${INDEX_PATH}`,
      verdicts: [
        {
          isEligible: true,
          release: { id: RELEASE.id, rolloutPercentage: 0 },
        },
      ],
    });
  });

  it('should print none with the HTTP status when no index is served, and evaluate nothing', async () => {
    harness.routes[`GET ${INDEX_PATH}`] = () =>
      new Response('not found', { status: 404 });

    await deviceProbeCommand.action(
      {
        app: DEMO_APP.id,
        binaryBuild: '57',
        binaryVersion: '2.4.1',
        channel: STAGING_CHANNEL.id,
        platform: 'ios',
      },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      'Channel  staging, ios',
      `Index    none: HTTP 404 at ${API_URL}${INDEX_PATH}; a device gets no release`,
      'Outcome  none',
      'Unknown  os, rollout, treated as passing; pass --device for the facts of a real device',
    ]);
  });

  it("should take the channel and the facts from the device's record, its attributes beside --attribute", async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/devices/${DEVICE.deviceId}`] =
      () => Response.json({ ...DEVICE, fingerprint: FINGERPRINT });
    harness.routes[
      `GET /v1/apps/${DEMO_APP.id}/devices/${DEVICE.deviceId}/events`
    ] = () => Response.json([]);
    respondWithIndex({
      ...INDEX,
      releases: [
        {
          ...RELEASE,
          conditions: [
            {
              key: 'tier',
              type: 'attribute',
              valueSha256:
                '0000000000000000000000000000000000000000000000000000000000000000',
            },
          ],
        },
      ],
    });

    await deviceProbeCommand.action(
      {
        app: DEMO_APP.id,
        attribute: ['userId=42'],
        device: DEVICE.deviceId,
        json: true,
      },
      undefined,
    );

    expect(harness.readJson()).toMatchObject({
      channelId: STAGING_CHANNEL.id,
      device: {
        attributes: { tier: 'beta', userId: '42' },
        binaryBuild: '57',
        binaryVersion: '2.4.1',
        deviceId: DEVICE.deviceId,
        fingerprint: FINGERPRINT,
        osVersion: '17.4',
      },
      outcome: { condition: 'attribute', reason: 'DEVICE_NOT_TARGETED' },
      unknownFacts: [],
    });
  });

  it('should ask for the app once when no hotcodepush.json names it', async () => {
    stubInteractiveTerminal();
    vi.spyOn(process, 'cwd').mockReturnValue('/');
    vi.mocked(select).mockResolvedValue(DEMO_APP.id);
    respondWithOrganizationApps();

    await deviceProbeCommand.action(
      {
        binaryBuild: '57',
        binaryVersion: '2.4.1',
        channel: STAGING_CHANNEL.id,
        platform: 'ios',
      },
      undefined,
    );

    expect(select).toHaveBeenCalledOnce();
  });

  it('should list the organizations once when --app is a name', async () => {
    respondWithOrganizationApps();

    await deviceProbeCommand.action(
      {
        app: DEMO_APP.name,
        binaryBuild: '57',
        binaryVersion: '2.4.1',
        channel: STAGING_CHANNEL.id,
        json: true,
        platform: 'ios',
      },
      undefined,
    );

    expect(
      harness.requests.filter(
        ({ url }) => new URL(url).pathname === '/v1/organizations',
      ),
    ).toHaveLength(1);
  });
});
