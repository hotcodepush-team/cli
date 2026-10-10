import { confirm } from '@clack/prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
} from '../../../test/fixtures.js';
import {
  CHANNEL_PATH,
  RELEASES_PATH,
  respondWithStagingReleases,
} from '../../../test/release-routes.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import releaseRevokeCommand from './revoke.js';

vi.mock('@clack/prompts');

const OLDEST_RELEASE = {
  ...PREVIOUS_RELEASE,
  bundle: PREVIOUS_BUNDLE,
  deviceCount: 5,
  id: 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a8b',
  number: 41,
};

const PRODUCTION_CHANNEL_PATH = `/v1/apps/${DEMO_APP.id}/channels/${PRODUCTION_CHANNEL.id}`;

const PRODUCTION_RELEASE = {
  ...LIVE_RELEASE,
  bundle: READY_BUNDLE,
  channel: PRODUCTION_CHANNEL,
  channelId: PRODUCTION_CHANNEL.id,
  deviceCount: 900,
  id: 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f',
  number: 7,
};

const REVOKED_RELEASE = { ...LIVE_RELEASE, state: 'revoked' as const };

describe('release revoke', () => {
  const harness = useCommandHarness();
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    respondWithStagingReleases(harness);
    harness.routes[`POST ${RELEASES_PATH}/${LIVE_RELEASE.id}/revoke`] = () =>
      Response.json(REVOKED_RELEASE);
  });

  function readRevokeRequests(): Request[] {
    return harness.requests.filter(({ url }) => url.endsWith('/revoke'));
  }

  function respondWithBulkRevocation(channelPath: string): void {
    harness.routes[`POST ${channelPath}/releases/revoke`] = () =>
      Response.json([
        REVOKED_RELEASE,
        { ...PREVIOUS_RELEASE, state: 'revoked' },
      ]);
  }

  it('should revoke the release named by number once confirmed, stating how many devices move where, that revoked is final and how its bundle comes back', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);

    await releaseRevokeCommand.action(
      {
        config: harness.writeProjectConfig({
          appId: DEMO_APP.id,
          channel: STAGING_CHANNEL.name,
        }),
        release: '43',
      },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This revokes release #43 of staging for good: 80 devices move to release #42; revoked is final, and "release create --bundle 17" releases its bundle again. Continue?',
    });
    expect(
      readRevokeRequests().map(({ url }) => new URL(url).pathname),
    ).toEqual([`${RELEASES_PATH}/${LIVE_RELEASE.id}/revoke`]);
    expect(harness.readLines()).toEqual([
      `Revoked release #43 of staging (${LIVE_RELEASE.id}).`,
    ]);
  });

  it('should revoke without asking and print the release as JSON when --yes and --json are passed', async () => {
    await releaseRevokeCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        json: true,
        release: LIVE_RELEASE.id,
        yes: true,
      },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(harness.readJson()).toEqual(REVOKED_RELEASE);
  });

  it('should stop with E_CONFIRMATION_REQUIRED when nobody can confirm', async () => {
    await expect(
      releaseRevokeCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, release: '43' },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);

    expect(readRevokeRequests()).toEqual([]);
  });

  it('should say the devices return to the embedded bundle when no older active release exists', async () => {
    harness.routes[`GET ${CHANNEL_PATH}/releases`] = () =>
      Response.json([
        { ...LIVE_RELEASE, bundle: READY_BUNDLE },
        { ...PREVIOUS_RELEASE, bundle: PREVIOUS_BUNDLE, state: 'revoked' },
      ]);

    await expect(
      releaseRevokeCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, release: '43' },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        'revokes release #43 of staging for good: 80 devices return to the embedded bundle; revoked is final, and "release create --bundle 17" releases its bundle again',
      ),
    );
  });

  it('should warn when the release the devices would land on is paused, and name the one further back', async () => {
    harness.routes[`GET ${CHANNEL_PATH}/releases`] = () =>
      Response.json([
        { ...LIVE_RELEASE, bundle: READY_BUNDLE },
        { ...PREVIOUS_RELEASE, bundle: PREVIOUS_BUNDLE, state: 'paused' },
        OLDEST_RELEASE,
      ]);

    await expect(
      releaseRevokeCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, release: '43' },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        'revokes release #43 of staging for good: 80 devices move to release #41; revoked is final, and "release create --bundle 17" releases its bundle again',
      ),
    );
    expect(stderrWrite).toHaveBeenCalledWith(
      'Warning: release #42 of staging is paused, so the devices that would land on it land one further back\n',
    );
  });

  it('should send the ids of the releases from the number --release-from names, inclusive, to the bulk route without asking, and print the releases as JSON when --yes and --json are passed', async () => {
    respondWithBulkRevocation(CHANNEL_PATH);
    harness.routes[`GET ${CHANNEL_PATH}/releases`] = () =>
      Response.json([
        { ...LIVE_RELEASE, bundle: READY_BUNDLE },
        { ...PREVIOUS_RELEASE, bundle: PREVIOUS_BUNDLE },
        OLDEST_RELEASE,
      ]);

    await releaseRevokeCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        json: true,
        releaseFrom: 42,
        yes: true,
      },
      undefined,
    );

    const [revokeRequest] = readRevokeRequests();
    expect(new URL(revokeRequest?.url ?? '').pathname).toBe(
      `${CHANNEL_PATH}/releases/revoke`,
    );
    expect(await revokeRequest?.json()).toEqual({
      releaseIds: [PREVIOUS_RELEASE.id, LIVE_RELEASE.id],
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(harness.readJson()).toEqual([
      REVOKED_RELEASE,
      { ...PREVIOUS_RELEASE, state: 'revoked' },
    ]);
  });

  it('should revoke every release of the channel listed with --all by its id once confirmed, every device returning to the embedded bundle', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithBulkRevocation(CHANNEL_PATH);

    await releaseRevokeCommand.action(
      { all: true, app: DEMO_APP.id, channel: STAGING_CHANNEL.id },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This revokes releases #43 and #42 of staging for good: 100 devices return to the embedded bundle; revoked is final, and "release create --bundle <number>" releases a bundle again. Continue?',
    });
    const [revokeRequest] = readRevokeRequests();
    expect(await revokeRequest?.json()).toEqual({
      releaseIds: [PREVIOUS_RELEASE.id, LIVE_RELEASE.id],
    });
    expect(harness.readLines()).toEqual([
      'Revoked releases #43 and #42 of staging.',
    ]);
  });

  it('should send the ids to the bulk route in pages of 100, the oldest page first, when more than 100 releases are revoked', async () => {
    const releaseLog = Array.from({ length: 101 }, (_, index) => ({
      ...LIVE_RELEASE,
      bundle: READY_BUNDLE,
      id: `00000000-0000-4000-8000-${String(101 - index).padStart(12, '0')}`,
      number: 101 - index,
    }));
    harness.routes[`GET ${CHANNEL_PATH}/releases`] = ({ url }) => {
      const { searchParams } = new URL(url);
      const offset = Number(searchParams.get('offset'));
      return Response.json(
        releaseLog.slice(offset, offset + Number(searchParams.get('limit'))),
      );
    };
    harness.routes[`POST ${CHANNEL_PATH}/releases/revoke`] = async request => {
      const { releaseIds } = (await request.json()) as { releaseIds: string[] };
      return Response.json(
        releaseLog
          .filter(({ id }) => releaseIds.includes(id))
          .map(release => ({ ...release, state: 'revoked' })),
      );
    };

    await releaseRevokeCommand.action(
      {
        all: true,
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        json: true,
        yes: true,
      },
      undefined,
    );

    expect(
      await Promise.all(readRevokeRequests().map(request => request.json())),
    ).toEqual([
      {
        releaseIds: releaseLog
          .slice(1)
          .map(({ id }) => id)
          .toReversed(),
      },
      { releaseIds: [releaseLog[0]?.id] },
    ]);
    expect(harness.readJson()).toEqual(
      releaseLog.map(release => ({ ...release, state: 'revoked' })),
    );
  });

  it("should revoke every release of the bundle --bundle names in each channel serving it, the channel's own ids through the bulk route", async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/bundles`] = () =>
      Response.json([READY_BUNDLE, PREVIOUS_BUNDLE]);
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/bundles/${READY_BUNDLE.id}`] =
      () => Response.json(READY_BUNDLE);
    harness.routes[`GET ${RELEASES_PATH}`] = () =>
      Response.json([
        PRODUCTION_RELEASE,
        { ...LIVE_RELEASE, bundle: READY_BUNDLE, channel: STAGING_CHANNEL },
        {
          ...LIVE_RELEASE,
          bundle: READY_BUNDLE,
          channel: STAGING_CHANNEL,
          id: 'f6a7b8c9-d0e1-4f2a-9b3c-4d5e6f7a8b9c',
          number: 40,
          state: 'revoked',
        },
      ]);
    harness.routes[`GET ${PRODUCTION_CHANNEL_PATH}/releases`] = () =>
      Response.json([PRODUCTION_RELEASE]);
    harness.routes[`POST ${PRODUCTION_CHANNEL_PATH}/releases/revoke`] = () =>
      Response.json([{ ...PRODUCTION_RELEASE, state: 'revoked' }]);
    harness.routes[`POST ${CHANNEL_PATH}/releases/revoke`] = () =>
      Response.json([REVOKED_RELEASE]);

    await releaseRevokeCommand.action(
      { app: DEMO_APP.id, bundle: '17' },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This revokes release #7 of production and release #43 of staging for good: 900 devices return to the embedded bundle in production; 80 devices move to release #42 in staging; revoked is final, and "release create --bundle 17" releases its bundle again. Continue?',
    });
    expect(
      await Promise.all(
        readRevokeRequests().map(async request => [
          new URL(request.url).pathname,
          await request.json(),
        ]),
      ),
    ).toEqual([
      [
        `${PRODUCTION_CHANNEL_PATH}/releases/revoke`,
        { releaseIds: [PRODUCTION_RELEASE.id] },
      ],
      [`${CHANNEL_PATH}/releases/revoke`, { releaseIds: [LIVE_RELEASE.id] }],
    ]);
  });

  it('should print that nothing is left to revoke and call nothing when every release named is revoked already', async () => {
    await releaseRevokeCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        releaseFrom: 50,
        yes: true,
      },
      undefined,
    );

    expect(readRevokeRequests()).toEqual([]);
    expect(harness.readLines()).toEqual([
      'Nothing to revoke: no release named is active or paused.',
    ]);
  });

  it('should refuse two forms at once', async () => {
    await expect(
      releaseRevokeCommand.action(
        { all: true, app: DEMO_APP.id, release: '43', yes: true },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'E_INVALID_PARAMETER' });

    expect(harness.requests).toEqual([]);
  });

  it('should refuse --bundle with --channel, since it revokes across channels', async () => {
    await expect(
      releaseRevokeCommand.action(
        {
          app: DEMO_APP.id,
          bundle: '17',
          channel: STAGING_CHANNEL.name,
          yes: true,
        },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'E_INVALID_PARAMETER' });

    expect(harness.requests).toEqual([]);
  });
});
