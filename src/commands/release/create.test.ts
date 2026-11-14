import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { S_SUCCESS } from '@clack/prompts';
import type { App, Audience, Channel, Release } from '@hotcodepush/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPACITOR_FINGERPRINT } from '../../../test/capacitor-project.js';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  DEMO_APP,
  LIVE_RELEASE,
  PREVIOUS_BUNDLE,
  PRODUCTION_CHANNEL,
  PROGRESSING_RELEASE,
  READY_BUNDLE,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import { writeReactNativeProject } from '../../../test/react-native-project.js';
import {
  CHANNEL_PATH,
  LIVE_RELEASE_WITH_RELATIONS,
  PREVIOUS_RELEASE_WITH_RELATIONS,
  RELEASES_PATH,
  respondWithChannels,
  respondWithRelease,
  respondWithReleases,
  STAGING_AUDIENCE,
} from '../../../test/release-routes.js';
import { collectBundleFiles } from '../../upload/bundle-files.js';
import type * as bundleUploadModule from '../../upload/bundle-upload.js';
import { buildBundleUpload } from '../../upload/bundle-upload.js';
import type * as uploadModule from '../../upload/upload.js';
import type { UploadBundleOptions } from '../../upload/upload.js';
import { uploadBundle } from '../../upload/upload.js';
import {
  ConfirmationRequiredError,
  InvalidParameterError,
  MissingParameterError,
} from '../../utils/errors.js';
import { createReporter } from '../../utils/progress.js';
import { confirm, select } from '../../utils/prompt-renderers.js';
import releaseCreateCommand from './create.js';

vi.mock('../../utils/prompt-renderers.js', () =>
  import('../../../test/prompt-renderers.js').then(
    ({ promptRenderersMock }) => promptRenderersMock,
  ),
);
vi.mock('../../upload/bundle-upload.js', async importOriginal => ({
  ...(await importOriginal<typeof bundleUploadModule>()),
  buildBundleUpload: vi.fn(),
}));
vi.mock('../../upload/bundle-files.js');
vi.mock('../../upload/upload.js', async importOriginal => ({
  ...(await importOriginal<typeof uploadModule>()),
  uploadBundle: vi.fn(),
}));

const BUNDLES_PATH = `/v1/apps/${DEMO_APP.id}/bundles`;

const DEVICE_ID = '6b1e9d37-2f5c-4a80-9c46-d8e3a1f7b259';

const PRODUCTION_CHANNEL_PATH = `/v1/apps/${DEMO_APP.id}/channels/${PRODUCTION_CHANNEL.id}`;

const UNSUPPORTED_CONDITION_SHARE_WARNING: Audience['warnings'][number] = {
  code: 'unsupported_condition_share',
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

function buildReleaseWithRelations(
  release: Release,
  channel: Channel,
): Release {
  return { ...release, bundle: READY_BUNDLE, channel };
}

describe('release create', () => {
  const harness = useCommandHarness();

  beforeEach(() => {});

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

  function respondWithBundleNamedByNumber(): void {
    harness.routes[`GET ${BUNDLES_PATH}`] = () => Response.json([READY_BUNDLE]);
    harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
      Response.json(READY_BUNDLE);
  }

  function respondWithStagingChannel(audience = STAGING_AUDIENCE): void {
    respondWithChannels(harness);
    harness.routes[`GET ${CHANNEL_PATH}`] = () =>
      Response.json(STAGING_CHANNEL);
    harness.routes[`GET ${CHANNEL_PATH}/audience`] = () =>
      Response.json(audience);
  }

  function respondWithOrganizationApps(): void {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION]);
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}/apps`] = () =>
      Response.json([DEMO_APP]);
  }

  function respondWithCreatedRelease({
    channel = STAGING_CHANNEL,
    release = LIVE_RELEASE,
  }: { channel?: Channel; release?: Release } = {}): void {
    harness.routes[
      `POST /v1/apps/${DEMO_APP.id}/channels/${channel.id}/releases`
    ] = () => Response.json(release, { status: 201 });
    respondWithRelease(harness, buildReleaseWithRelations(release, channel));
  }

  function stubWebBuildUpload(): void {
    vi.mocked(buildBundleUpload).mockResolvedValue(UPLOAD_BUNDLE_OPTIONS);
    vi.mocked(uploadBundle).mockResolvedValue({
      bundle: { ...READY_BUNDLE, fingerprint: CAPACITOR_FINGERPRINT },
      upload: { fileCount: 0, sizeBytes: 0 },
    });
  }

  it('should release the bundle named by number to the project channel once confirmed, and wait until it is live', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithStagingChannel();
    respondWithBundleNamedByNumber();
    respondWithCreatedRelease();
    harness.routes[`POST ${CHANNEL_PATH}/releases`] = () =>
      Response.json({ ...LIVE_RELEASE, liveAt: null }, { status: 201 });

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
    expect(await createRequest?.json()).toEqual({
      bundleId: READY_BUNDLE.id,
      conditions: [],
      isMandatory: false,
      notes: null,
      platform: null,
      rolloutPercent: 100,
    });
    expect(
      harness.requests.filter(
        ({ url }) =>
          new URL(url).pathname === `${RELEASES_PATH}/${LIVE_RELEASE.id}`,
      ),
    ).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `${S_SUCCESS}  Created release #43 of staging.`,
      `   ID       ${LIVE_RELEASE.id}`,
      '   Bundle   #17 · 1.4.2',
      '   Rollout  100 percent',
      `   Live     ${LIVE_RELEASE.liveAt}`,
      '',
    ]);
  });

  it('should ask for the app once for --bundle when no hotcodepush.json names it', async () => {
    stubInteractiveTerminal();
    vi.spyOn(process, 'cwd').mockReturnValue('/');
    vi.mocked(select).mockResolvedValue(DEMO_APP.id);
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithOrganizationApps();
    respondWithStagingChannel();
    respondWithBundleNamedByNumber();
    respondWithCreatedRelease();

    await releaseCreateCommand.action(
      { bundle: '17', channel: STAGING_CHANNEL.id },
      undefined,
    );

    expect(select).toHaveBeenCalledOnce();
  });

  it('should list the organizations once for --bundle when --app is a name', async () => {
    respondWithOrganizationApps();
    respondWithStagingChannel();
    respondWithBundleNamedByNumber();
    respondWithCreatedRelease();

    await releaseCreateCommand.action(
      {
        app: DEMO_APP.name,
        bundle: '17',
        channel: STAGING_CHANNEL.id,
        json: true,
        yes: true,
      },
      undefined,
    );

    expect(
      harness.requests.filter(
        ({ url }) => new URL(url).pathname === '/v1/organizations',
      ),
    ).toHaveLength(1);
  });

  it('should upload the web build first without --bundle, with its fingerprint as a condition, and print the one release as a JSON object with its bundle and its channel when --yes and --json are passed', async () => {
    stubWebBuildUpload();
    respondWithStagingChannel();
    respondWithCreatedRelease();

    await releaseCreateCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        json: true,
        mandatory: true,
        notes: 'cart fix',
        path: 'dist',
        rolloutPercent: 10,
        yes: true,
      },
      undefined,
    );

    expect(buildBundleUpload).toHaveBeenCalledWith(expect.anything(), {
      isDryRun: undefined,
      options: expect.objectContaining({ path: 'dist' }),
      packagingDirectoryPath: expect.any(String),
    });
    expect(uploadBundle).toHaveBeenCalledWith(
      expect.anything(),
      UPLOAD_BUNDLE_OPTIONS,
    );
    expect(confirm).not.toHaveBeenCalled();
    const [createRequest] = readCreateRequests();
    expect(await createRequest?.json()).toEqual({
      bundleId: READY_BUNDLE.id,
      conditions: [{ fingerprint: CAPACITOR_FINGERPRINT, type: 'fingerprint' }],
      isMandatory: true,
      notes: 'cart fix',
      platform: null,
      rolloutPercent: 10,
    });
    expect(readCreateRequests()).toHaveLength(1);
    expect(harness.readJson()).toEqual(
      buildReleaseWithRelations(LIVE_RELEASE, STAGING_CHANNEL),
    );
  });

  it('should send a new Idempotency-Key on every run, so a second run creates a second release', async () => {
    respondWithStagingChannel();
    respondWithBundleNamedByNumber();
    respondWithCreatedRelease();
    const options = {
      bundle: '17',
      config: harness.writeProjectConfig({
        appId: DEMO_APP.id,
        channel: STAGING_CHANNEL.name,
      }),
      yes: true,
    };

    await releaseCreateCommand.action(options, undefined);
    await releaseCreateCommand.action(options, undefined);

    const sentKeys = readCreateRequests().map(({ headers }) =>
      headers.get('Idempotency-Key'),
    );
    expect(sentKeys).toEqual([expect.any(String), expect.any(String)]);
    expect(sentKeys[1]).not.toBe(sentKeys[0]);
  });

  it("should send the same Idempotency-Key on the client's retry when the API answers a server error", async () => {
    respondWithStagingChannel();
    respondWithBundleNamedByNumber();
    respondWithCreatedRelease();
    harness.routes[`POST ${CHANNEL_PATH}/releases`] = vi
      .fn<() => Response>()
      .mockReturnValueOnce(
        new Response(null, { headers: { 'Retry-After': '0' }, status: 503 }),
      )
      .mockReturnValueOnce(Response.json(LIVE_RELEASE, { status: 201 }));

    await releaseCreateCommand.action(
      {
        bundle: '17',
        config: harness.writeProjectConfig({
          appId: DEMO_APP.id,
          channel: STAGING_CHANNEL.name,
        }),
        yes: true,
      },
      undefined,
    );

    const sentKeys = readCreateRequests().map(({ headers }) =>
      headers.get('Idempotency-Key'),
    );
    expect(sentKeys).toEqual([expect.any(String), sentKeys[0]]);
  });

  describe('when conditions are named', () => {
    const OPTIONS = {
      app: DEMO_APP.id,
      attribute: ['tier=beta'],
      binaryVersion: '>=2.3.0 <3.0.0',
      bundle: READY_BUNDLE.id,
      channel: STAGING_CHANNEL.id,
      device: [DEVICE_ID],
      osVersion: '>=17',
      yes: true,
    };

    beforeEach(() => {
      respondWithStagingChannel();
      respondWithCreatedRelease();
      harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
        Response.json({ ...READY_BUNDLE, fingerprint: CAPACITOR_FINGERPRINT });
    });

    it('should create the release with every condition as typed and the bundle fingerprint beside them', async () => {
      await releaseCreateCommand.action(OPTIONS, undefined);

      const [createRequest] = readCreateRequests();
      expect(await createRequest?.json()).toMatchObject({
        conditions: [
          {
            key: 'tier',
            type: 'attribute',
            value: 'beta',
          },
          { range: '>=2.3.0 <3.0.0', type: 'binary' },
          { ids: [DEVICE_ID], type: 'device' },
          { fingerprint: CAPACITOR_FINGERPRINT, type: 'fingerprint' },
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
        rolloutPercent: '100',
      });
    });

    it('should fail with `invalid_parameter` before anything is asked when an attribute is no key=value pair', async () => {
      await expect(
        releaseCreateCommand.action(
          { ...OPTIONS, attribute: ['tier'] },
          undefined,
        ),
      ).rejects.toMatchObject({ code: 'invalid_parameter' });

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
        channel: STAGING_CHANNEL.id,
        failureAction: 'revoke',
        failureMinimumUpdateCount: 50,
        failureThresholdPercent: 5,
        yes: true,
      },
      undefined,
    );

    const [createRequest] = readCreateRequests();
    expect(await createRequest?.json()).toMatchObject({
      failureAction: 'revoke',
      failureMinimumUpdateCount: 50,
      failureThresholdPercent: 5,
    });
  });

  describe('when --progression gives the release a schedule', () => {
    beforeEach(() => {
      respondWithStagingChannel();
      harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
        Response.json(READY_BUNDLE);
      respondWithCreatedRelease({ release: PROGRESSING_RELEASE });
    });

    it("should start at the default schedule's first percentage once confirmed, stating the schedule", async () => {
      stubInteractiveTerminal();
      vi.mocked(confirm).mockResolvedValue(true);

      await releaseCreateCommand.action(
        {
          app: DEMO_APP.id,
          bundle: READY_BUNDLE.id,
          channel: STAGING_CHANNEL.id,
          progression: true,
        },
        undefined,
      );

      expect(confirm).toHaveBeenCalledWith({
        initialValue: false,
        message:
          'This releases bundle #17 · 1.4.2 at 10 percent, progressing through 10, 50, 100 percent, each step at least 3600 seconds and 50 applied updates: reaches 100 of 120 active devices in staging, about 100 at a 10 percent rollout. Continue?',
      });
      expect(readAudienceUrls()[0]?.searchParams.get('rolloutPercent')).toBe(
        '10',
      );
      const [createRequest] = readCreateRequests();
      expect(await createRequest?.json()).toMatchObject({
        progression: {
          rolloutPercents: [10, 50, 100],
          stepMinimumSeconds: 3600,
          stepMinimumUpdateCount: 50,
        },
        rolloutPercent: 10,
      });
      expect(harness.readLines()).toEqual([
        `${S_SUCCESS}  Created release #43 of staging.`,
        `   ID       ${LIVE_RELEASE.id}`,
        '   Bundle   #17 · 1.4.2',
        '   Rollout  10 percent, then 50 and 100',
        `   Live     ${LIVE_RELEASE.liveAt}`,
        '',
      ]);
    });

    it('should send the schedule its flags override from the percentage --rollout-percent names', async () => {
      await releaseCreateCommand.action(
        {
          app: DEMO_APP.id,
          bundle: READY_BUNDLE.id,
          channel: STAGING_CHANNEL.id,
          json: true,
          progression: true,
          progressionMinimumSeconds: 600,
          progressionMinimumUpdateCount: 20,
          progressionRolloutPercents: [25, 100],
          rolloutPercent: 5,
          yes: true,
        },
        undefined,
      );

      const [createRequest] = readCreateRequests();
      expect(await createRequest?.json()).toMatchObject({
        progression: {
          rolloutPercents: [25, 100],
          stepMinimumSeconds: 600,
          stepMinimumUpdateCount: 20,
        },
        rolloutPercent: 5,
      });
      expect(harness.readJson()).toEqual(
        buildReleaseWithRelations(PROGRESSING_RELEASE, STAGING_CHANNEL),
      );
    });

    it("should refuse a schedule's flag without --progression before any request", async () => {
      await expect(
        releaseCreateCommand.action(
          {
            app: DEMO_APP.id,
            bundle: READY_BUNDLE.id,
            progressionMinimumSeconds: 600,
            yes: true,
          },
          undefined,
        ),
      ).rejects.toMatchObject({
        code: 'invalid_parameter',
        message:
          "The schedule's flags --progression-minimum-seconds apply only with --progression.",
      });
      expect(harness.requests).toEqual([]);
    });
  });

  describe('when --from-channel names the channel to release from', () => {
    const OPTIONS = {
      app: DEMO_APP.id,
      channel: STAGING_CHANNEL.id,
      fromChannel: PRODUCTION_CHANNEL.name,
    };

    const NEWEST_PRODUCTION_RELEASE: Release = {
      ...LIVE_RELEASE_WITH_RELATIONS,
      channel: PRODUCTION_CHANNEL,
      channelId: PRODUCTION_CHANNEL.id,
      number: 9,
    };

    const OLDER_PRODUCTION_RELEASE: Release = {
      ...PREVIOUS_RELEASE_WITH_RELATIONS,
      channel: PRODUCTION_CHANNEL,
      channelId: PRODUCTION_CHANNEL.id,
      number: 8,
    };

    beforeEach(() => {
      respondWithStagingChannel();
      respondWithCreatedRelease();
      respondWithApp(DEMO_APP);
      harness.routes[`GET ${PRODUCTION_CHANNEL_PATH}`] = () =>
        Response.json(PRODUCTION_CHANNEL);
    });

    function respondWithApp(app: App): void {
      harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () => Response.json(app);
    }

    it("should release what that channel's newest active release serves, naming it in the confirmation", async () => {
      respondWithReleases(harness, [
        { ...NEWEST_PRODUCTION_RELEASE, status: 'revoked' },
        OLDER_PRODUCTION_RELEASE,
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
        platform: null,
        rolloutPercent: 100,
      });
    });

    describe('in a React Native app', () => {
      const IOS_BUNDLE = { ...PREVIOUS_BUNDLE, platforms: ['ios' as const] };

      beforeEach(() => {
        respondWithApp({ ...DEMO_APP, framework: 'react_native' });
        respondWithReleases(harness, [
          {
            ...NEWEST_PRODUCTION_RELEASE,
            bundle: { ...READY_BUNDLE, platforms: ['android'] },
          },
          { ...OLDER_PRODUCTION_RELEASE, bundle: IOS_BUNDLE },
        ]);
      });

      it('should send the platform and name the newest active release serving it in the confirmation', async () => {
        stubInteractiveTerminal();
        vi.mocked(confirm).mockResolvedValue(true);

        await releaseCreateCommand.action(
          { ...OPTIONS, platform: 'ios' },
          undefined,
        );

        expect(confirm).toHaveBeenCalledWith({
          initialValue: false,
          message:
            'This releases bundle #16 · 1.4.1, release #8 of production, at 100 percent: reaches 60 ios devices in staging. Continue?',
        });
        const [createRequest] = readCreateRequests();
        expect(await createRequest?.json()).toMatchObject({
          fromChannelId: PRODUCTION_CHANNEL.id,
          platform: 'ios',
        });
      });

      it('should refuse with `missing_parameter` naming --platform when it is missing and nobody can answer', async () => {
        await expect(
          releaseCreateCommand.action({ ...OPTIONS, yes: true }, undefined),
        ).rejects.toThrow(new MissingParameterError('--platform'));

        expect(readCreateRequests()).toEqual([]);
      });
    });

    it('should fail with `invalid_parameter` when that channel serves no active release', async () => {
      respondWithReleases(harness, []);

      await expect(
        releaseCreateCommand.action({ ...OPTIONS, yes: true }, undefined),
      ).rejects.toMatchObject({
        code: 'invalid_parameter',
        fix: 'Release a bundle to that channel first with release create.',
        message:
          'The channel production from --from-channel serves no active release.',
      });
      expect(readCreateRequests()).toEqual([]);
    });
  });

  describe('when --dry-run is passed', () => {
    const OPTIONS = {
      app: DEMO_APP.id,
      bundle: READY_BUNDLE.id,
      channel: STAGING_CHANNEL.id,
      dryRun: true,
      rolloutPercent: 5,
    };

    beforeEach(() => {
      respondWithStagingChannel({
        ...STAGING_AUDIENCE,
        estimatedDeviceCount: 5,
        warnings: [UNSUPPORTED_CONDITION_SHARE_WARNING],
      });
      harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
        Response.json(READY_BUNDLE);
    });

    it('should print the audience and the preview warnings, and publish nothing without asking', async () => {
      await releaseCreateCommand.action(OPTIONS, undefined);

      expect(harness.readLines()).toEqual([
        'Dry run, nothing published: this releases bundle #17 · 1.4.2 at 5 percent: reaches 100 of 120 active devices in staging, about 5 at a 5 percent rollout.',
      ]);
      expect(harness.readDiagnostics()).toBe(
        `${UNSUPPORTED_CONDITION_SHARE_WARNING.message}\n`,
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(readCreateRequests()).toEqual([]);
    });

    it("should print the channel's audience as one JSON object", async () => {
      await releaseCreateCommand.action({ ...OPTIONS, json: true }, undefined);

      expect(harness.readJson()).toEqual({
        ...STAGING_AUDIENCE,
        channelId: STAGING_CHANNEL.id,
        estimatedDeviceCount: 5,
        warnings: [UNSUPPORTED_CONDITION_SHARE_WARNING],
      });
    });

    it('should resolve the web build as a dry run, needing no private key, hash it and upload nothing when the build is the source', async () => {
      stubWebBuildUpload();
      vi.mocked(collectBundleFiles).mockResolvedValue([]);

      await releaseCreateCommand.action(
        { ...OPTIONS, bundle: undefined, path: 'dist' },
        undefined,
      );

      expect(buildBundleUpload).toHaveBeenCalledWith(expect.anything(), {
        isDryRun: true,
        options: expect.objectContaining({ path: 'dist' }),
        packagingDirectoryPath: expect.any(String),
      });
      expect(collectBundleFiles).toHaveBeenCalledWith(
        UPLOAD_BUNDLE_OPTIONS.directoryPath,
      );
      expect(uploadBundle).not.toHaveBeenCalled();
      expect(readCreateRequests()).toEqual([]);
    });
  });

  it("should print the audience preview's warnings once the release is created", async () => {
    const fingerprintUnknownWarning: Audience['warnings'][number] = {
      code: 'fingerprint_unknown',
      details: { fingerprint: CAPACITOR_FINGERPRINT },
      message: 'No binary of the app carries this fingerprint.',
    };
    stubWebBuildUpload();
    respondWithStagingChannel({
      ...STAGING_AUDIENCE,
      warnings: [
        fingerprintUnknownWarning,
        UNSUPPORTED_CONDITION_SHARE_WARNING,
      ],
    });
    respondWithCreatedRelease();

    await releaseCreateCommand.action(
      {
        app: DEMO_APP.id,
        attribute: ['tier=beta'],
        channel: STAGING_CHANNEL.id,
        path: 'dist',
        yes: true,
      },
      undefined,
    );

    expect(harness.readDiagnostics()).toBe(
      `${fingerprintUnknownWarning.message}\n${UNSUPPORTED_CONDITION_SHARE_WARNING.message}\n`,
    );
  });

  it('should stop with `confirmation_required` stating the audience at a partial rollout, with the mandatory flag, when nobody can confirm', async () => {
    respondWithStagingChannel({ ...STAGING_AUDIENCE, estimatedDeviceCount: 6 });
    harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
      Response.json(READY_BUNDLE);

    await expect(
      releaseCreateCommand.action(
        {
          app: DEMO_APP.id,
          bundle: READY_BUNDLE.id,
          channel: STAGING_CHANNEL.id,
          mandatory: true,
          rolloutPercent: 5,
        },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        'releases bundle #17 · 1.4.2 at 5 percent, mandatory: reaches 100 of 120 active devices in staging, about 6 at a 5 percent rollout',
      ),
    );

    expect(readCreateRequests()).toEqual([]);
  });

  describe('when the web build is still to upload', () => {
    const OPTIONS = {
      app: DEMO_APP.id,
      channel: STAGING_CHANNEL.id,
      path: 'dist',
    };

    it('should stop with `confirmation_required` before uploading anything when nobody can confirm', async () => {
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

  describe('when the bundle of one platform is still to upload', () => {
    const OPTIONS = { app: DEMO_APP.id, channel: STAGING_CHANNEL.id };

    beforeEach(() => {
      vi.mocked(buildBundleUpload).mockResolvedValue({
        ...UPLOAD_BUNDLE_OPTIONS,
        platforms: ['ios'],
      });
      vi.mocked(uploadBundle).mockResolvedValue({
        bundle: { ...READY_BUNDLE, fingerprint: CAPACITOR_FINGERPRINT },
        upload: { fileCount: 0, sizeBytes: 0 },
      });
      respondWithStagingChannel();
    });

    it('should name the bundle by its platform in the confirmation, before uploading anything', async () => {
      await expect(
        releaseCreateCommand.action(OPTIONS, undefined),
      ).rejects.toThrow(
        new ConfirmationRequiredError(
          'uploads the ios bundle as 1.4.2 and releases it at 100 percent: reaches 100 of 120 active devices in staging',
        ),
      );

      expect(uploadBundle).not.toHaveBeenCalled();
    });

    it('should upload the one bundle and make one release of it', async () => {
      respondWithCreatedRelease();

      await releaseCreateCommand.action(
        { ...OPTIONS, json: true, yes: true },
        undefined,
      );

      expect(uploadBundle).toHaveBeenCalledOnce();
      expect(readCreateRequests()).toHaveLength(1);
      expect(harness.readJson()).toEqual(
        buildReleaseWithRelations(LIVE_RELEASE, STAGING_CHANNEL),
      );
    });
  });

  it('should count only the devices of the platform --platform names when it narrows a bundle serving both', async () => {
    respondWithStagingChannel();
    respondWithBundleNamedByNumber();

    await expect(
      releaseCreateCommand.action(
        {
          app: DEMO_APP.id,
          bundle: '17',
          channel: STAGING_CHANNEL.id,
          platform: 'android',
        },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        'releases bundle #17 · 1.4.2 at 100 percent: reaches 40 android devices in staging',
      ),
    );
  });

  it('should refuse with `missing_parameter` naming --platform before any upload when a React Native build is to upload and nobody can answer', async () => {
    const { buildBundleUpload: buildActualBundleUpload } =
      await vi.importActual<typeof bundleUploadModule>(
        '../../upload/bundle-upload.js',
      );
    vi.mocked(buildBundleUpload).mockImplementationOnce(
      buildActualBundleUpload,
    );
    const directoryPath = writeReactNativeProject({
      projectConfig: { appId: DEMO_APP.id, channel: STAGING_CHANNEL.name },
    });

    try {
      await expect(
        releaseCreateCommand.action(
          { config: join(directoryPath, 'hotcodepush.json'), yes: true },
          undefined,
        ),
      ).rejects.toThrow(new MissingParameterError('--platform'));
    } finally {
      rmSync(directoryPath, { force: true, recursive: true });
    }

    expect(uploadBundle).not.toHaveBeenCalled();
    expect(readCreateRequests()).toEqual([]);
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
});
