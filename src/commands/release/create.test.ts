import { confirm } from '@clack/prompts';
import type { Audience } from '@hotcodepush/node';
import {
  computeSha256Hex,
  hashAttribute,
  hashDeviceId,
  stringifyCanonicalJson,
} from '@hotcodepush/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPACITOR_FINGERPRINT } from '../../../test/capacitor-project.js';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  DEMO_APP,
  LIVE_RELEASE,
  PREVIOUS_BUNDLE,
  PREVIOUS_RELEASE,
  PRODUCTION_CHANNEL,
  READY_BUNDLE,
  STAGING_CHANNEL,
  STAGING_CHANNEL_WITH_DEVICE_COUNTS,
} from '../../../test/fixtures.js';
import {
  CHANNEL_PATH,
  RELEASES_PATH,
  respondWithChannels,
  STAGING_AUDIENCE,
} from '../../../test/release-routes.js';
import { collectBundleFiles } from '../../utils/bundle-files.js';
import {
  ConfirmationRequiredError,
  InvalidParameterError,
} from '../../utils/errors.js';
import { createReporter } from '../../utils/progress.js';
import type * as uploadModule from '../../utils/upload.js';
import type { UploadBundleOptions } from '../../utils/upload.js';
import { uploadBundle } from '../../utils/upload.js';
import type * as bundleUploadModule from '../bundle/upload.js';
import { resolveUploadBundleOptions } from '../bundle/upload.js';
import releaseCreateCommand, { resolveReleaseConsequence } from './create.js';

vi.mock('@clack/prompts');
vi.mock('../bundle/upload.js', async importOriginal => ({
  ...(await importOriginal<typeof bundleUploadModule>()),
  resolveUploadBundleOptions: vi.fn(),
}));
vi.mock('../../utils/bundle-files.js');
vi.mock('../../utils/upload.js', async importOriginal => ({
  ...(await importOriginal<typeof uploadModule>()),
  uploadBundle: vi.fn(),
}));

const BUNDLES_PATH = `/v1/apps/${DEMO_APP.id}/bundles`;

const DEVICE_ID = '6b1e9d37-2f5c-4a80-9c46-d8e3a1f7b259';

const PRODUCTION_CHANNEL_PATH = `/v1/apps/${DEMO_APP.id}/channels/${PRODUCTION_CHANNEL.id}`;

const UNSUPPORTED_CONDITION_SHARE_WARNING: Audience['warnings'][number] = {
  code: 'UNSUPPORTED_CONDITION_SHARE',
  details: null,
  message:
    "12 of the channel's 120 active devices run an SDK that does not know the condition type attribute and will not see this release until the app ships a newer SDK.",
};

const UPLOAD_BUNDLE_OPTIONS: UploadBundleOptions = {
  appId: DEMO_APP.id,
  bundleVersion: '1.4.2',
  directoryPath: '/projects/demo/dist',
  fingerprint: CAPACITOR_FINGERPRINT,
  gitProvenance: {
    gitMessage: null,
    gitRef: null,
    gitRemote: null,
    gitSha: null,
    isGitDirty: null,
  },
  platforms: ['android', 'ios'],
  reporter: createReporter({ json: true }),
  signingPrivateKey: null,
};

const PRODUCTION_RELEASE = {
  ...LIVE_RELEASE,
  channelId: PRODUCTION_CHANNEL.id,
  id: 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f',
  number: 7,
};

describe('release create', () => {
  const harness = useCommandHarness();
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  function readCreateRequests(): Request[] {
    return harness.requests.filter(
      ({ method, url }) => method === 'POST' && url.endsWith('/releases'),
    );
  }

  function readAudienceUrls(): URL[] {
    return harness.requests
      .map(({ url }) => new URL(url))
      .filter(({ pathname }) => pathname.endsWith('/audience'));
  }

  function respondWithStagingChannel(audience = STAGING_AUDIENCE): void {
    respondWithChannels(harness);
    harness.routes[`GET ${CHANNEL_PATH}`] = () =>
      Response.json(STAGING_CHANNEL_WITH_DEVICE_COUNTS);
    harness.routes[`GET ${CHANNEL_PATH}/audience`] = () =>
      Response.json(audience);
  }

  function respondWithCreatedRelease(
    warnings: Audience['warnings'] = [],
  ): void {
    harness.routes[`POST ${CHANNEL_PATH}/releases`] = () =>
      Response.json({ ...LIVE_RELEASE, warnings }, { status: 201 });
  }

  function stubWebBuildUpload(warnings: Audience['warnings'] = []): void {
    vi.mocked(resolveUploadBundleOptions).mockResolvedValue([
      UPLOAD_BUNDLE_OPTIONS,
    ]);
    vi.mocked(uploadBundle).mockResolvedValue({
      bundle: { ...READY_BUNDLE, fingerprint: CAPACITOR_FINGERPRINT },
      deltaBaseBundleIds: [],
      patchCount: 0,
      uploadedBytes: 0,
      uploadedFileCount: 0,
      warnings,
    });
  }

  it('should release the bundle named by number to the project channel once confirmed, and wait until it is live', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithStagingChannel();
    harness.routes[`GET ${BUNDLES_PATH}`] = () => Response.json([READY_BUNDLE]);
    harness.routes[`POST ${CHANNEL_PATH}/releases`] = () =>
      Response.json(
        { ...LIVE_RELEASE, liveAt: null, warnings: [] },
        { status: 201 },
      );
    harness.routes[`GET ${RELEASES_PATH}/${LIVE_RELEASE.id}`] = () =>
      Response.json(LIVE_RELEASE);

    await releaseCreateCommand.action(
      {
        bundle: '17',
        config: harness.writeProjectConfig({
          appId: DEMO_APP.id,
          channel: STAGING_CHANNEL.name,
        }),
      },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This releases bundle #17 · 1.4.2 at 100 percent: reaches 100 of 120 active devices in staging. Continue?',
    });
    const [createRequest] = readCreateRequests();
    const releaseBody = {
      bundleId: READY_BUNDLE.id,
      conditions: [],
      isMandatory: false,
      notes: null,
      rolloutPercentage: 100,
    };
    expect(await createRequest?.json()).toEqual(releaseBody);
    expect(createRequest?.headers.get('Idempotency-Key')).toBe(
      computeSha256Hex(
        `${READY_BUNDLE.manifestSha256}:${STAGING_CHANNEL.id}:${stringifyCanonicalJson(releaseBody)}`,
      ),
    );
    expect(
      harness.requests.filter(({ url }) =>
        url.endsWith(`${RELEASES_PATH}/${LIVE_RELEASE.id}`),
      ),
    ).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Released bundle #17 · 1.4.2 to staging as release #43 at 100 percent, live since ${LIVE_RELEASE.liveAt}.`,
    ]);
  });

  it('should upload the web build first without --bundle, with its fingerprint as a condition, and print the one release as a JSON array when --yes and --json are passed', async () => {
    stubWebBuildUpload();
    respondWithStagingChannel();
    respondWithCreatedRelease();

    await releaseCreateCommand.action(
      {
        app: DEMO_APP.id,
        channel: [STAGING_CHANNEL.id],
        json: true,
        mandatory: true,
        notes: 'cart fix',
        path: 'dist',
        rolloutPercentage: 10,
        yes: true,
      },
      undefined,
    );

    expect(resolveUploadBundleOptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ path: 'dist' }),
      expect.any(String),
    );
    expect(uploadBundle).toHaveBeenCalledWith(
      expect.anything(),
      UPLOAD_BUNDLE_OPTIONS,
    );
    expect(confirm).not.toHaveBeenCalled();
    const [createRequest] = readCreateRequests();
    expect(await createRequest?.json()).toEqual({
      bundleId: READY_BUNDLE.id,
      conditions: [{ hash: CAPACITOR_FINGERPRINT, type: 'fingerprint' }],
      isMandatory: true,
      notes: 'cart fix',
      rolloutPercentage: 10,
    });
    expect(harness.readJson()).toEqual([{ ...LIVE_RELEASE, warnings: [] }]);
  });

  describe('when conditions are named', () => {
    const OPTIONS = {
      app: DEMO_APP.id,
      attribute: ['tier=beta'],
      binary: '>=2.3.0 <3.0.0',
      bundle: READY_BUNDLE.id,
      channel: [STAGING_CHANNEL.id],
      device: [DEVICE_ID],
      os: '>=17',
      yes: true,
    };

    beforeEach(() => {
      respondWithStagingChannel();
      respondWithCreatedRelease();
      harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
        Response.json({ ...READY_BUNDLE, fingerprint: CAPACITOR_FINGERPRINT });
    });

    it('should create the release with every condition, the attribute value and the device ids hashed, and the bundle fingerprint beside them', async () => {
      await releaseCreateCommand.action(OPTIONS, undefined);

      const [createRequest] = readCreateRequests();
      expect(await createRequest?.json()).toMatchObject({
        conditions: [
          {
            key: 'tier',
            type: 'attribute',
            valueSha256: hashAttribute('tier', 'beta'),
          },
          { range: '>=2.3.0 <3.0.0', type: 'binary' },
          { hashedIds: [hashDeviceId(DEVICE_ID)], type: 'device' },
          { hash: CAPACITOR_FINGERPRINT, type: 'fingerprint' },
          { range: '>=17', type: 'os' },
        ],
      });
    });

    it('should ask the audience preview with the conditions as typed and the bundle fingerprint', async () => {
      await releaseCreateCommand.action(OPTIONS, undefined);

      const [audienceUrl] = readAudienceUrls();
      expect(Object.fromEntries(audienceUrl?.searchParams ?? [])).toEqual({
        attribute: 'tier=beta',
        binary: '>=2.3.0 <3.0.0',
        device: DEVICE_ID,
        fingerprint: CAPACITOR_FINGERPRINT,
        os: '>=17',
        rollout: '100',
      });
    });

    it('should fail with E_INVALID_PARAMETER before anything is asked when an attribute is no key=value pair', async () => {
      await expect(
        releaseCreateCommand.action(
          { ...OPTIONS, attribute: ['tier'] },
          undefined,
        ),
      ).rejects.toMatchObject({ code: 'E_INVALID_PARAMETER' });

      expect(readAudienceUrls()).toEqual([]);
      expect(readCreateRequests()).toEqual([]);
    });
  });

  it('should send the auto-pause overrides', async () => {
    respondWithStagingChannel();
    respondWithCreatedRelease();
    harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
      Response.json(READY_BUNDLE);

    await releaseCreateCommand.action(
      {
        app: DEMO_APP.id,
        bundle: READY_BUNDLE.id,
        channel: [STAGING_CHANNEL.id],
        failureAction: 'revoke',
        failureMinSample: 50,
        failureThreshold: 5,
        yes: true,
      },
      undefined,
    );

    const [createRequest] = readCreateRequests();
    expect(await createRequest?.json()).toMatchObject({
      failureAction: 'revoke',
      failureMinSample: 50,
      failureThresholdPercent: 5,
    });
  });

  describe('when --from-channel names the channel to release from', () => {
    const OPTIONS = {
      app: DEMO_APP.id,
      channel: [STAGING_CHANNEL.id],
      fromChannel: PRODUCTION_CHANNEL.name,
    };

    beforeEach(() => {
      respondWithStagingChannel();
      respondWithCreatedRelease();
      harness.routes[`GET ${PRODUCTION_CHANNEL_PATH}`] = () =>
        Response.json({
          ...PRODUCTION_CHANNEL,
          activeDeviceCount: 1000,
          currentDeviceCount: 900,
          embeddedDeviceCount: 100,
        });
    });

    it("should release what that channel's newest active release serves, naming it in the confirmation", async () => {
      harness.routes[`GET ${PRODUCTION_CHANNEL_PATH}/releases`] = () =>
        Response.json([
          { ...LIVE_RELEASE, number: 9, state: 'revoked' },
          { ...PREVIOUS_RELEASE, bundle: PREVIOUS_BUNDLE, number: 8 },
        ]);
      stubInteractiveTerminal();
      vi.mocked(confirm).mockResolvedValue(true);

      await releaseCreateCommand.action(OPTIONS, undefined);

      expect(confirm).toHaveBeenCalledWith({
        initialValue: false,
        message:
          'This releases bundle #16 · 1.4.1, release #8 of production, at 100 percent: reaches 100 of 120 active devices in staging. Continue?',
      });
      const [createRequest] = readCreateRequests();
      expect(await createRequest?.json()).toEqual({
        conditions: [],
        fromChannelId: PRODUCTION_CHANNEL.id,
        isMandatory: false,
        notes: null,
        rolloutPercentage: 100,
      });
    });

    it('should fail with E_INVALID_PARAMETER when that channel serves no active release', async () => {
      harness.routes[`GET ${PRODUCTION_CHANNEL_PATH}/releases`] = () =>
        Response.json([]);

      await expect(
        releaseCreateCommand.action({ ...OPTIONS, yes: true }, undefined),
      ).rejects.toMatchObject({
        code: 'E_INVALID_PARAMETER',
        message:
          '--from-channel: the channel production serves no active release',
      });
      expect(readCreateRequests()).toEqual([]);
    });
  });

  describe('when --dry-run is passed', () => {
    const OPTIONS = {
      app: DEMO_APP.id,
      bundle: READY_BUNDLE.id,
      channel: [STAGING_CHANNEL.id],
      dryRun: true,
      rolloutPercentage: 5,
    };

    beforeEach(() => {
      respondWithStagingChannel({
        ...STAGING_AUDIENCE,
        estimatedAtRollout: 5,
        warnings: [UNSUPPORTED_CONDITION_SHARE_WARNING],
      });
      harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
        Response.json(READY_BUNDLE);
    });

    it('should print the audience and the preview warnings, and publish nothing without asking', async () => {
      await releaseCreateCommand.action(OPTIONS, undefined);

      expect(harness.readLines()).toEqual([
        'Dry run, nothing published: this releases bundle #17 · 1.4.2 at 5 percent: reaches 100 of 120 active devices in staging; about 5 at a 5 percent rollout.',
      ]);
      expect(stderrWrite).toHaveBeenCalledWith(
        `Warning: ${UNSUPPORTED_CONDITION_SHARE_WARNING.message}\n`,
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(readCreateRequests()).toEqual([]);
    });

    it('should print the audience per channel as a JSON array', async () => {
      await releaseCreateCommand.action({ ...OPTIONS, json: true }, undefined);

      expect(harness.readJson()).toEqual([
        {
          ...STAGING_AUDIENCE,
          channelId: STAGING_CHANNEL.id,
          estimatedAtRollout: 5,
          warnings: [UNSUPPORTED_CONDITION_SHARE_WARNING],
        },
      ]);
    });

    it('should hash the web build and upload nothing when the build is the source', async () => {
      stubWebBuildUpload();
      vi.mocked(collectBundleFiles).mockResolvedValue([]);

      await releaseCreateCommand.action(
        { ...OPTIONS, bundle: undefined, path: 'dist' },
        undefined,
      );

      expect(collectBundleFiles).toHaveBeenCalledWith(
        UPLOAD_BUNDLE_OPTIONS.directoryPath,
      );
      expect(uploadBundle).not.toHaveBeenCalled();
      expect(readCreateRequests()).toEqual([]);
    });
  });

  it('should print the warnings the upload and the created release answer', async () => {
    const fingerprintUnregisteredWarning: Audience['warnings'][number] = {
      code: 'FINGERPRINT_UNREGISTERED',
      details: { fingerprint: CAPACITOR_FINGERPRINT },
      message: `No binary of the app is registered with the fingerprint ${CAPACITOR_FINGERPRINT}; a release of this bundle reaches no device until a store build with it is registered.`,
    };
    stubWebBuildUpload([fingerprintUnregisteredWarning]);
    respondWithStagingChannel();
    respondWithCreatedRelease([UNSUPPORTED_CONDITION_SHARE_WARNING]);

    await releaseCreateCommand.action(
      {
        app: DEMO_APP.id,
        attribute: ['tier=beta'],
        channel: [STAGING_CHANNEL.id],
        path: 'dist',
        yes: true,
      },
      undefined,
    );

    expect(stderrWrite).toHaveBeenCalledWith(
      `Warning: ${fingerprintUnregisteredWarning.message}\n`,
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      `Warning: ${UNSUPPORTED_CONDITION_SHARE_WARNING.message}\n`,
    );
  });

  describe('when several channels are named', () => {
    const OPTIONS = {
      app: DEMO_APP.id,
      bundle: READY_BUNDLE.id,
      channel: [STAGING_CHANNEL.id, PRODUCTION_CHANNEL.id],
      yes: true,
    };

    beforeEach(() => {
      respondWithStagingChannel();
      harness.routes[`GET ${PRODUCTION_CHANNEL_PATH}`] = () =>
        Response.json({
          ...PRODUCTION_CHANNEL,
          activeDeviceCount: 1000,
          currentDeviceCount: 900,
          embeddedDeviceCount: 100,
        });
      harness.routes[`GET ${PRODUCTION_CHANNEL_PATH}/audience`] = () =>
        Response.json({ ...STAGING_AUDIENCE, reached: 900, total: 1000 });
      harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
        Response.json(READY_BUNDLE);
      respondWithCreatedRelease();
      harness.routes[`POST ${PRODUCTION_CHANNEL_PATH}/releases`] = () =>
        Response.json({ ...PRODUCTION_RELEASE, warnings: [] }, { status: 201 });
    });

    it('should release to every channel named, one release each', async () => {
      await releaseCreateCommand.action(OPTIONS, undefined);

      expect(readCreateRequests()).toHaveLength(2);
      expect(harness.readLines()).toEqual([
        `Released bundle #17 · 1.4.2 to staging as release #43 at 100 percent, live since ${LIVE_RELEASE.liveAt}.`,
        `Released bundle #17 · 1.4.2 to production as release #7 at 100 percent, live since ${LIVE_RELEASE.liveAt}.`,
      ]);
    });

    it('should print the releases as a JSON array in the order of the channels', async () => {
      await releaseCreateCommand.action({ ...OPTIONS, json: true }, undefined);

      expect(harness.readJson()).toEqual([
        { ...LIVE_RELEASE, warnings: [] },
        { ...PRODUCTION_RELEASE, warnings: [] },
      ]);
    });
  });

  it('should stop with E_CONFIRMATION_REQUIRED when nobody can confirm', async () => {
    respondWithStagingChannel();
    harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
      Response.json(READY_BUNDLE);

    await expect(
      releaseCreateCommand.action(
        {
          app: DEMO_APP.id,
          bundle: READY_BUNDLE.id,
          channel: [STAGING_CHANNEL.id],
        },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);

    expect(readCreateRequests()).toEqual([]);
  });

  describe('when the web build is still to upload', () => {
    const OPTIONS = {
      app: DEMO_APP.id,
      channel: [STAGING_CHANNEL.id],
      path: 'dist',
    };

    it('should stop with E_CONFIRMATION_REQUIRED before uploading anything when nobody can confirm', async () => {
      stubWebBuildUpload();
      respondWithStagingChannel();

      await expect(
        releaseCreateCommand.action(OPTIONS, undefined),
      ).rejects.toThrow(
        new ConfirmationRequiredError(
          'uploads the web build as 1.4.2 and releases it at 100 percent: reaches 100 of 120 active devices in staging',
        ),
      );

      expect(uploadBundle).not.toHaveBeenCalled();
      expect(readCreateRequests()).toEqual([]);
    });

    it('should ask before uploading, and upload nothing when the answer is no', async () => {
      stubInteractiveTerminal();
      vi.mocked(confirm).mockResolvedValue(false);
      stubWebBuildUpload();
      respondWithStagingChannel();

      await releaseCreateCommand.action(OPTIONS, undefined);

      expect(confirm).toHaveBeenCalledWith({
        initialValue: false,
        message:
          'This uploads the web build as 1.4.2 and releases it at 100 percent: reaches 100 of 120 active devices in staging. Continue?',
      });
      expect(uploadBundle).not.toHaveBeenCalled();
      expect(readCreateRequests()).toEqual([]);
    });
  });

  describe('when each platform has a bundle of its own to upload', () => {
    const OPTIONS = { app: DEMO_APP.id, channel: [STAGING_CHANNEL.id] };

    function stubPlatformBundleUploads(): void {
      vi.mocked(resolveUploadBundleOptions).mockResolvedValue([
        { ...UPLOAD_BUNDLE_OPTIONS, platforms: ['android'] },
        { ...UPLOAD_BUNDLE_OPTIONS, platforms: ['ios'] },
      ]);
      for (const bundle of [READY_BUNDLE, PREVIOUS_BUNDLE]) {
        vi.mocked(uploadBundle).mockResolvedValueOnce({
          bundle: { ...bundle, fingerprint: CAPACITOR_FINGERPRINT },
          deltaBaseBundleIds: [],
          patchCount: 0,
          uploadedBytes: 0,
          uploadedFileCount: 0,
          warnings: [],
        });
      }
    }

    it('should name the bundles by their platforms in the confirmation, before uploading anything', async () => {
      stubPlatformBundleUploads();
      respondWithStagingChannel();

      await expect(
        releaseCreateCommand.action(OPTIONS, undefined),
      ).rejects.toThrow(
        new ConfirmationRequiredError(
          'uploads the android and ios bundles as 1.4.2 and releases each at 100 percent: reaches 100 of 120 active devices in staging',
        ),
      );

      expect(uploadBundle).not.toHaveBeenCalled();
    });

    it('should upload each bundle and release each to the channel', async () => {
      stubPlatformBundleUploads();
      respondWithStagingChannel();
      respondWithCreatedRelease();

      await releaseCreateCommand.action(
        { ...OPTIONS, json: true, yes: true },
        undefined,
      );

      expect(uploadBundle).toHaveBeenCalledTimes(2);
      expect(
        await Promise.all(
          readCreateRequests().map(async request => {
            const { bundleId } = (await request.json()) as {
              bundleId: string;
            };
            return bundleId;
          }),
        ),
      ).toEqual([READY_BUNDLE.id, PREVIOUS_BUNDLE.id]);
      expect(harness.readJson()).toHaveLength(2);
    });
  });

  it('should refuse --bundle together with --path', async () => {
    await expect(
      releaseCreateCommand.action(
        { app: DEMO_APP.id, bundle: '17', path: 'dist', yes: true },
        undefined,
      ),
    ).rejects.toBeInstanceOf(InvalidParameterError);

    expect(harness.requests).toEqual([]);
  });

  it('should refuse --bundle together with --from-channel', async () => {
    await expect(
      releaseCreateCommand.action(
        {
          app: DEMO_APP.id,
          bundle: '17',
          fromChannel: PRODUCTION_CHANNEL.name,
          yes: true,
        },
        undefined,
      ),
    ).rejects.toBeInstanceOf(InvalidParameterError);

    expect(harness.requests).toEqual([]);
  });

  it('should state the audience of each channel at a partial rollout, with the mandatory flag', () => {
    expect(
      resolveReleaseConsequence(
        { bundle: READY_BUNDLE },
        [
          {
            audience: { ...STAGING_AUDIENCE, estimatedAtRollout: 6 },
            channel: STAGING_CHANNEL_WITH_DEVICE_COUNTS,
          },
          {
            audience: {
              ...STAGING_AUDIENCE,
              estimatedAtRollout: 500,
              reached: 9995,
              total: 10_000,
            },
            channel: {
              ...PRODUCTION_CHANNEL,
              activeDeviceCount: 10_000,
              currentDeviceCount: 9000,
              embeddedDeviceCount: 1000,
            },
          },
        ],
        5,
        true,
      ),
    ).toBe(
      'releases bundle #17 · 1.4.2 at 5 percent, mandatory: reaches 100 of 120 active devices in staging; about 6 at a 5 percent rollout and reaches 9,995 of 10,000 active devices in production; about 500 at a 5 percent rollout',
    );
  });
});
