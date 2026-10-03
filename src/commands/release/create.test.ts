import { confirm } from '@clack/prompts';
import {
  computeSha256Hex,
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
  PRODUCTION_CHANNEL,
  READY_BUNDLE,
  STAGING_CHANNEL,
  STAGING_CHANNEL_WITH_DEVICE_COUNTS,
} from '../../../test/fixtures.js';
import {
  CHANNEL_PATH,
  RELEASES_PATH,
  respondWithChannels,
} from '../../../test/release-routes.js';
import {
  ConfirmationRequiredError,
  InvalidParameterError,
} from '../../utils/errors.js';
import { createReporter } from '../../utils/progress.js';
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
vi.mock('../../utils/upload.js');

const BUNDLES_PATH = `/v1/apps/${DEMO_APP.id}/bundles`;

const PRODUCTION_CHANNEL_PATH = `/v1/apps/${DEMO_APP.id}/channels/${PRODUCTION_CHANNEL.id}`;

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
};

const PRODUCTION_RELEASE = {
  ...LIVE_RELEASE,
  channelId: PRODUCTION_CHANNEL.id,
  id: 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f',
  number: 7,
};

describe('release create', () => {
  const harness = useCommandHarness();

  function readCreateRequests(): Request[] {
    return harness.requests.filter(
      ({ method, url }) => method === 'POST' && url.endsWith('/releases'),
    );
  }

  function respondWithStagingChannel(): void {
    respondWithChannels(harness);
    harness.routes[`GET ${CHANNEL_PATH}`] = () =>
      Response.json(STAGING_CHANNEL_WITH_DEVICE_COUNTS);
  }

  function stubWebBuildUpload(): void {
    vi.mocked(resolveUploadBundleOptions).mockResolvedValue(
      UPLOAD_BUNDLE_OPTIONS,
    );
    vi.mocked(uploadBundle).mockResolvedValue({
      bundle: READY_BUNDLE,
      deltaBaseBundleId: null,
      uploadedBytes: 0,
      uploadedFileCount: 0,
    });
  }

  it('should release the bundle named by number to the project channel once confirmed, and wait until it is live', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithStagingChannel();
    harness.routes[`GET ${BUNDLES_PATH}`] = () => Response.json([READY_BUNDLE]);
    harness.routes[`POST ${CHANNEL_PATH}/releases`] = () =>
      Response.json({ ...LIVE_RELEASE, liveAt: null }, { status: 201 });
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
        'This releases bundle #17 · 1.4.2 at 100 percent: reaches 120 devices in staging. Continue?',
    });
    const [createRequest] = readCreateRequests();
    const releaseBody = {
      bundleId: READY_BUNDLE.id,
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

  it('should upload the web build first without --bundle, and print the one release as a JSON array when --yes and --json are passed', async () => {
    stubWebBuildUpload();
    respondWithStagingChannel();
    harness.routes[`POST ${CHANNEL_PATH}/releases`] = () =>
      Response.json(LIVE_RELEASE, { status: 201 });

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
    );
    expect(uploadBundle).toHaveBeenCalledWith(
      expect.anything(),
      UPLOAD_BUNDLE_OPTIONS,
    );
    expect(confirm).not.toHaveBeenCalled();
    const [createRequest] = readCreateRequests();
    expect(await createRequest?.json()).toEqual({
      bundleId: READY_BUNDLE.id,
      isMandatory: true,
      notes: 'cart fix',
      rolloutPercentage: 10,
    });
    expect(harness.readJson()).toEqual([LIVE_RELEASE]);
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
      harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
        Response.json(READY_BUNDLE);
      harness.routes[`POST ${CHANNEL_PATH}/releases`] = () =>
        Response.json(LIVE_RELEASE, { status: 201 });
      harness.routes[`POST ${PRODUCTION_CHANNEL_PATH}/releases`] = () =>
        Response.json(PRODUCTION_RELEASE, { status: 201 });
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

      expect(harness.readJson()).toEqual([LIVE_RELEASE, PRODUCTION_RELEASE]);
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
          'uploads the web build as 1.4.2 and releases it at 100 percent: reaches 120 devices in staging',
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
          'This uploads the web build as 1.4.2 and releases it at 100 percent: reaches 120 devices in staging. Continue?',
      });
      expect(uploadBundle).not.toHaveBeenCalled();
      expect(readCreateRequests()).toEqual([]);
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

  it('should state the share of each channel at a partial rollout, with the mandatory flag', () => {
    expect(
      resolveReleaseConsequence(
        { bundle: READY_BUNDLE },
        [
          STAGING_CHANNEL_WITH_DEVICE_COUNTS,
          {
            ...PRODUCTION_CHANNEL,
            activeDeviceCount: 10_000,
            currentDeviceCount: 9000,
            embeddedDeviceCount: 1000,
          },
        ],
        5,
        true,
      ),
    ).toBe(
      'releases bundle #17 · 1.4.2 at 5 percent, mandatory: reaches about 6 of 120 devices in staging and about 500 of 10,000 devices in production',
    );
  });
});
