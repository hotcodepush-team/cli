import { S_SUCCESS } from '@clack/prompts';
import type { Bundle, Release } from '@hotcodepush/node';
import { describe, expect, it, vi } from 'vitest';
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
  READY_BUNDLE,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import {
  CHANNEL_PATH,
  FLEET_PATH,
  RELEASES_PATH,
  respondWithStagingReleases,
  STAGING_AUDIENCE,
} from '../../../test/release-routes.js';
import {
  ConfirmationRequiredError,
  MissingParameterError,
  NoEarlierReleaseError,
} from '../../utils/errors.js';
import { confirm } from '../../utils/prompt-renderers.js';
import releaseRollbackCommand from './rollback.js';

vi.mock('../../utils/prompt-renderers.js', () =>
  import('../../../test/prompt-renderers.js').then(
    ({ promptRenderersMock }) => promptRenderersMock,
  ),
);

const ROLLBACK_RELEASE: Release = {
  ...LIVE_RELEASE,
  bundle: PREVIOUS_BUNDLE,
  bundleId: PREVIOUS_BUNDLE.id,
  createdAt: '2026-09-08T08:00:00.000Z',
  id: 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f7a',
  liveAt: '2026-09-08T08:00:05.000Z',
  number: 44,
  rolledBackFromReleaseId: LIVE_RELEASE.id,
};

const NO_EARLIER_RELEASE_ERROR = new NoEarlierReleaseError({
  channelName: STAGING_CHANNEL.name,
  releaseNumber: LIVE_RELEASE.number,
});

function buildPlatformRelease(
  release: Release,
  { bundle, number }: { bundle: Bundle; number: number },
): Release {
  return {
    ...release,
    bundle,
    bundleId: bundle.id,
    id: `${release.id.slice(0, -2)}${number}`,
    number,
  };
}

describe('release rollback', () => {
  const harness = useCommandHarness();

  function readRollbackRequests(): Request[] {
    return harness.requests.filter(({ url }) => url.endsWith('/rollbacks'));
  }

  function respondWithRollback(): void {
    respondWithStagingReleases(harness);
    harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json(DEMO_APP);
    harness.routes[`POST ${CHANNEL_PATH}/rollbacks`] = () =>
      Response.json({ ...ROLLBACK_RELEASE, liveAt: null }, { status: 201 });
    harness.routes[`GET ${RELEASES_PATH}/${ROLLBACK_RELEASE.id}`] = () =>
      Response.json(ROLLBACK_RELEASE);
    respondWithTargetReach(PREVIOUS_RELEASE);
  }

  function respondWithTargetReach(
    targetRelease: Release,
    audience = STAGING_AUDIENCE,
  ): void {
    harness.routes[`GET ${RELEASES_PATH}/${targetRelease.id}/audience`] = () =>
      Response.json(audience);
  }

  it('should name the undone and the target release with its reach once confirmed, warn of nothing when both bundles carry one fingerprint, send the target it named and wait until the new release is live', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithRollback();

    await releaseRollbackCommand.action(
      {
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
        'This rolls staging back from #43 (android, ios · 1.4.2) to #42 (android, ios · 1.4.1), reaching 100 of 120 devices. Continue?',
    });
    const [rollbackRequest] = readRollbackRequests();
    expect(await rollbackRequest?.json()).toEqual({
      isMandatory: true,
      platform: null,
      toReleaseId: PREVIOUS_RELEASE.id,
    });
    expect(harness.readLines()).toEqual([
      `${S_SUCCESS}  Created release #44 of staging.`,
      `   ID       ${ROLLBACK_RELEASE.id}`,
      '   Bundle   #16 · 1.4.1',
      '   Rollout  100 percent',
      `   Live     ${ROLLBACK_RELEASE.liveAt}`,
      '',
    ]);
  });

  it("should name every device on the undone release as out of the target's reach when the two bundles carry different fingerprints", async () => {
    respondWithRollback();
    harness.routes[`GET ${RELEASES_PATH}`] = () =>
      Response.json([
        {
          ...LIVE_RELEASE,
          bundle: { ...READY_BUNDLE, fingerprint: CAPACITOR_FINGERPRINT },
        },
        { ...PREVIOUS_RELEASE, bundle: PREVIOUS_BUNDLE },
      ]);

    await expect(
      releaseRollbackCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        "rolls staging back from #43 (android, ios · 1.4.2) to #42 (android, ios · 1.4.1), reaching 100 of 120 devices. #42 reaches none of the 80 devices on #43, whose store build carries another fingerprint. Revoke #43 to send them back to the store build's bundle",
      ),
    );
    const fleetUrl = harness.requests
      .map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === FLEET_PATH);
    expect(fleetUrl?.searchParams.get('channelId')).toBe(STAGING_CHANNEL.id);
  });

  it('should narrow a rollback of a bundle serving both platforms to the one --platform names', async () => {
    respondWithRollback();

    await releaseRollbackCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        platform: 'android',
        yes: true,
      },
      undefined,
    );

    const [rollbackRequest] = readRollbackRequests();
    expect(await rollbackRequest?.json()).toEqual({
      isMandatory: true,
      platform: 'android',
      toReleaseId: PREVIOUS_RELEASE.id,
    });
  });

  it('should send the release --to-release names and print the new release as JSON when --yes and --json are passed', async () => {
    respondWithRollback();

    await releaseRollbackCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        json: true,
        toRelease: '42',
        yes: true,
      },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    const [rollbackRequest] = readRollbackRequests();
    expect(await rollbackRequest?.json()).toEqual({
      isMandatory: true,
      platform: null,
      toReleaseId: PREVIOUS_RELEASE.id,
    });
    expect(harness.readJson()).toEqual(ROLLBACK_RELEASE);
  });

  it('should name the newest earlier active release as the target when a release of the same bundle comes first and a revoked one is skipped', async () => {
    const sameBundleRelease = buildPlatformRelease(LIVE_RELEASE, {
      bundle: READY_BUNDLE,
      number: 41,
    });
    respondWithRollback();
    harness.routes[`GET ${RELEASES_PATH}`] = () =>
      Response.json([
        { ...LIVE_RELEASE, bundle: READY_BUNDLE },
        { ...PREVIOUS_RELEASE, bundle: PREVIOUS_BUNDLE, status: 'revoked' },
        sameBundleRelease,
      ]);
    respondWithTargetReach(sameBundleRelease);

    await expect(
      releaseRollbackCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        'rolls staging back from #43 (android, ios · 1.4.2) to #41 (android, ios · 1.4.2), reaching 100 of 120 devices',
      ),
    );
  });

  it('should send an optional rollback when --mandatory false is passed', async () => {
    respondWithRollback();

    await releaseRollbackCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        mandatory: false,
        yes: true,
      },
      undefined,
    );

    const [rollbackRequest] = readRollbackRequests();
    expect(await rollbackRequest?.json()).toMatchObject({
      isMandatory: false,
    });
  });

  describe('in a React Native app', () => {
    const ANDROID_BUNDLE: Bundle = { ...READY_BUNDLE, platforms: ['android'] };
    const IOS_BUNDLE: Bundle = { ...READY_BUNDLE, platforms: ['ios'] };
    const OLDER_IOS_BUNDLE: Bundle = {
      ...PREVIOUS_BUNDLE,
      platforms: ['ios'],
    };
    const OLDER_IOS_RELEASE = buildPlatformRelease(LIVE_RELEASE, {
      bundle: OLDER_IOS_BUNDLE,
      number: 42,
    });

    function respondWithPlatformReleases(): void {
      respondWithRollback();
      harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () =>
        Response.json({ ...DEMO_APP, framework: 'react_native' });
      harness.routes[`GET ${RELEASES_PATH}`] = () =>
        Response.json([
          buildPlatformRelease(LIVE_RELEASE, {
            bundle: ANDROID_BUNDLE,
            number: 45,
          }),
          buildPlatformRelease(LIVE_RELEASE, {
            bundle: IOS_BUNDLE,
            number: 44,
          }),
          buildPlatformRelease(LIVE_RELEASE, {
            bundle: ANDROID_BUNDLE,
            number: 43,
          }),
          OLDER_IOS_RELEASE,
        ]);
      respondWithTargetReach(OLDER_IOS_RELEASE);
    }

    it('should roll back the newest release serving --platform to the one before it on that platform, sending the platform', async () => {
      stubInteractiveTerminal();
      vi.mocked(confirm).mockResolvedValue(true);
      respondWithPlatformReleases();

      await releaseRollbackCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, platform: 'ios' },
        undefined,
      );

      expect(confirm).toHaveBeenCalledWith({
        initialValue: false,
        message:
          'This rolls staging back from #44 (ios · 1.4.2) to #42 (ios · 1.4.1), reaching 100 of 120 devices. Continue?',
      });
      const [rollbackRequest] = readRollbackRequests();
      expect(await rollbackRequest?.json()).toEqual({
        isMandatory: true,
        platform: 'ios',
        toReleaseId: OLDER_IOS_RELEASE.id,
      });
    });

    it('should refuse --to-release before any rollback when its bundle does not serve --platform', async () => {
      respondWithPlatformReleases();

      await expect(
        releaseRollbackCommand.action(
          {
            app: DEMO_APP.id,
            channel: STAGING_CHANNEL.id,
            platform: 'ios',
            toRelease: '43',
            yes: true,
          },
          undefined,
        ),
      ).rejects.toMatchObject({
        code: 'invalid_parameter',
        fix: 'Name a release whose bundle serves ios with --to-release.',
        message:
          'The bundle of release #43 from --to-release does not serve ios.',
      });

      expect(readRollbackRequests()).toEqual([]);
    });

    it('should refuse with `missing_parameter` naming --platform before any rollback when it is missing and nobody can answer', async () => {
      respondWithPlatformReleases();

      await expect(
        releaseRollbackCommand.action(
          { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, yes: true },
          undefined,
        ),
      ).rejects.toThrow(new MissingParameterError('--platform'));

      expect(readRollbackRequests()).toEqual([]);
    });
  });

  it('should point to release revoke before any rollback when nothing came before the newest release', async () => {
    respondWithRollback();
    harness.routes[`GET ${RELEASES_PATH}`] = () =>
      Response.json([{ ...LIVE_RELEASE, bundle: READY_BUNDLE }]);

    await expect(
      releaseRollbackCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, yes: true },
        undefined,
      ),
    ).rejects.toThrow(NO_EARLIER_RELEASE_ERROR);

    expect(NO_EARLIER_RELEASE_ERROR).toMatchObject({
      code: 'validation',
      fix: `Revoke #43 to send its devices back to the store build's bundle: "hotcodepush release revoke --channel staging --release 43".`,
      message: 'Nothing came before #43 on this binary.',
    });
    expect(readRollbackRequests()).toEqual([]);
  });
});
