import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../testing/command-harness.js';
import {
  DEMO_APP,
  LIVE_RELEASE,
  PREVIOUS_BUNDLE,
  PREVIOUS_RELEASE,
  READY_BUNDLE,
  STAGING_CHANNEL,
} from '../../testing/fixtures.js';
import {
  CHANNEL_PATH,
  RELEASES_PATH,
  respondWithStagingReleases,
} from '../../testing/release-routes.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import releaseRevokeCommand from './revoke.js';

vi.mock('@clack/prompts');

const REVOKED_RELEASE = { ...LIVE_RELEASE, state: 'revoked' as const };

describe('release revoke', () => {
  const harness = useCommandHarness();

  function readRevokeRequests(): Request[] {
    return harness.requests.filter(({ url }) => url.endsWith('/revoke'));
  }

  function respondWithRevokedRelease(): void {
    respondWithStagingReleases(harness);
    harness.routes[`POST ${RELEASES_PATH}/${LIVE_RELEASE.id}/revoke`] = () =>
      Response.json(REVOKED_RELEASE);
  }

  it('should revoke the release named by number once confirmed, stating how many devices move and to which release', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithRevokedRelease();

    await releaseRevokeCommand.action(
      {
        config: harness.writeProjectConfig({
          appId: DEMO_APP.id,
          channelId: STAGING_CHANNEL.id,
        }),
        release: '43',
      },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This revokes release #43 of staging for good: 80 devices on it move to release #42. Continue?',
    });
    expect(readRevokeRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Revoked release #43 of staging (${LIVE_RELEASE.id}).`,
    ]);
  });

  it('should revoke without asking and print the release as JSON when --yes and --json are passed', async () => {
    respondWithRevokedRelease();

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
    respondWithRevokedRelease();

    await expect(
      releaseRevokeCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, release: '43' },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);

    expect(readRevokeRequests()).toEqual([]);
  });

  it('should say the devices move to the embedded bundle when no older active release exists', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithRevokedRelease();
    harness.routes[`GET ${CHANNEL_PATH}/releases`] = () =>
      Response.json([
        { ...LIVE_RELEASE, bundle: READY_BUNDLE },
        { ...PREVIOUS_RELEASE, bundle: PREVIOUS_BUNDLE, state: 'revoked' },
      ]);

    await releaseRevokeCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, release: '43' },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This revokes release #43 of staging for good: 80 devices on it move to the embedded bundle. Continue?',
    });
    expect(readRevokeRequests()).toEqual([]);
  });
});
