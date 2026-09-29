import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../testing/command-harness.js';
import {
  DEMO_APP,
  LIVE_RELEASE,
  STAGING_CHANNEL,
} from '../../testing/fixtures.js';
import {
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

  it('should revoke the release named by number once confirmed, stating where its devices go', async () => {
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
        'This revokes release #43 of staging for good: devices on it move to the newest older release they qualify for or the embedded bundle. Continue?',
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
});
