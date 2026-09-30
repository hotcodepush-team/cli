import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  DEMO_APP,
  LIVE_RELEASE,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import {
  RELEASES_PATH,
  respondWithStagingReleases,
} from '../../../test/release-routes.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import releasePauseCommand from './pause.js';

vi.mock('@clack/prompts');

const PAUSED_RELEASE = {
  ...LIVE_RELEASE,
  pausedAt: '2026-09-29T12:00:00.000Z',
  state: 'paused' as const,
};

describe('release pause', () => {
  const harness = useCommandHarness();

  function readPauseRequests(): Request[] {
    return harness.requests.filter(({ url }) => url.endsWith('/pause'));
  }

  function respondWithPausedRelease(): void {
    respondWithStagingReleases(harness);
    harness.routes[`POST ${RELEASES_PATH}/${LIVE_RELEASE.id}/pause`] = () =>
      Response.json(PAUSED_RELEASE);
  }

  it('should pause the release named by number once confirmed, stating that devices on it keep it', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithPausedRelease();

    await releasePauseCommand.action(
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
        'This pauses release #43 of staging: devices on it keep it and no new device gets it. Continue?',
    });
    expect(readPauseRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Paused release #43 of staging (${LIVE_RELEASE.id}).`,
    ]);
  });

  it('should pause without asking and print the release as JSON when --yes and --json are passed', async () => {
    respondWithPausedRelease();

    await releasePauseCommand.action(
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
    expect(harness.readJson()).toEqual(PAUSED_RELEASE);
  });

  it('should stop with E_CONFIRMATION_REQUIRED when nobody can confirm', async () => {
    respondWithPausedRelease();

    await expect(
      releasePauseCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, release: '43' },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);

    expect(readPauseRequests()).toEqual([]);
  });
});
