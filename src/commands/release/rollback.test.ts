import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
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
  RELEASES_PATH,
  respondWithStagingReleases,
} from '../../../test/release-routes.js';
import { InvalidParameterError } from '../../utils/errors.js';
import releaseRollbackCommand from './rollback.js';

vi.mock('@clack/prompts');

const ROLLBACK_RELEASE = {
  ...LIVE_RELEASE,
  bundleId: PREVIOUS_BUNDLE.id,
  createdAt: '2026-09-08T08:00:00.000Z',
  id: 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f7a',
  liveAt: '2026-09-08T08:00:05.000Z',
  number: 44,
  rolledBackFromReleaseId: LIVE_RELEASE.id,
};

describe('release rollback', () => {
  const harness = useCommandHarness();

  function readRollbackRequests(): Request[] {
    return harness.requests.filter(({ url }) => url.endsWith('/rollbacks'));
  }

  function respondWithRollback(): void {
    respondWithStagingReleases(harness);
    harness.routes[`POST ${CHANNEL_PATH}/rollbacks`] = () =>
      Response.json({ ...ROLLBACK_RELEASE, liveAt: null }, { status: 201 });
    harness.routes[`GET ${RELEASES_PATH}/${ROLLBACK_RELEASE.id}`] = () =>
      Response.json(ROLLBACK_RELEASE);
  }

  it('should roll the project channel back to its previous bundle once confirmed, and wait until the new release is live', async () => {
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
        'This rolls channel staging back to bundle #16 · 1.4.1 of release #42 as a new mandatory release, reaching its 120 active devices. Continue?',
    });
    const [rollbackRequest] = readRollbackRequests();
    expect(await rollbackRequest?.json()).toEqual({
      isMandatory: true,
      toReleaseId: PREVIOUS_RELEASE.id,
    });
    expect(harness.readLines()).toEqual([
      `Released bundle #16 · 1.4.1 to staging as release #44 at 100 percent, live since ${ROLLBACK_RELEASE.liveAt}.`,
    ]);
  });

  it('should roll back to the release --to-release names and print the new release as JSON when --yes and --json are passed', async () => {
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
      toReleaseId: PREVIOUS_RELEASE.id,
    });
    expect(harness.readJson()).toEqual(ROLLBACK_RELEASE);
  });

  it('should skip revoked releases and releases of the current bundle when picking the previous one', async () => {
    respondWithRollback();
    const OLDEST_RELEASE = {
      ...PREVIOUS_RELEASE,
      id: 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a8b',
      number: 40,
    };
    harness.routes[`GET ${CHANNEL_PATH}/releases`] = () =>
      Response.json([
        { ...LIVE_RELEASE, bundle: READY_BUNDLE },
        { ...PREVIOUS_RELEASE, bundle: PREVIOUS_BUNDLE, state: 'revoked' },
        {
          ...LIVE_RELEASE,
          bundle: READY_BUNDLE,
          id: 'f6a7b8c9-d0e1-4f2a-9b3c-4d5e6f7a8b9c',
          number: 41,
        },
        { ...OLDEST_RELEASE, bundle: PREVIOUS_BUNDLE },
      ]);

    await releaseRollbackCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, yes: true },
      undefined,
    );

    const [rollbackRequest] = readRollbackRequests();
    expect(await rollbackRequest?.json()).toEqual({
      isMandatory: true,
      toReleaseId: OLDEST_RELEASE.id,
    });
  });

  it('should create an optional release when --mandatory false is passed', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithRollback();

    await releaseRollbackCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, mandatory: false },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This rolls channel staging back to bundle #16 · 1.4.1 of release #42 as a new release, reaching its 120 active devices. Continue?',
    });
    const [rollbackRequest] = readRollbackRequests();
    expect(await rollbackRequest?.json()).toEqual({
      isMandatory: false,
      toReleaseId: PREVIOUS_RELEASE.id,
    });
  });

  it('should refuse when the channel has no earlier release to roll back to', async () => {
    respondWithRollback();
    harness.routes[`GET ${CHANNEL_PATH}/releases`] = () =>
      Response.json([{ ...LIVE_RELEASE, bundle: READY_BUNDLE }]);

    await expect(
      releaseRollbackCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, yes: true },
        undefined,
      ),
    ).rejects.toBeInstanceOf(InvalidParameterError);

    expect(readRollbackRequests()).toEqual([]);
  });
});
