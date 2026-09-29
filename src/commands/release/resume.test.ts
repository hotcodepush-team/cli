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
import releaseResumeCommand from './resume.js';

vi.mock('@clack/prompts');

const RESUMED_RELEASE = LIVE_RELEASE;

describe('release resume', () => {
  const harness = useCommandHarness();

  function readResumeRequests(): Request[] {
    return harness.requests.filter(({ url }) => url.endsWith('/resume'));
  }

  function respondWithResumedRelease(): void {
    respondWithStagingReleases(harness);
    harness.routes[`POST ${RELEASES_PATH}/${LIVE_RELEASE.id}/resume`] = () =>
      Response.json(RESUMED_RELEASE);
  }

  it('should resume the release named by number once confirmed, stating that devices get it again', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithResumedRelease();

    await releaseResumeCommand.action(
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
        'This resumes release #43 of staging: devices get it again and a new auto-pause window starts. Continue?',
    });
    expect(readResumeRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Resumed release #43 of staging (${LIVE_RELEASE.id}).`,
    ]);
  });

  it('should resume without asking and print the release as JSON when --yes and --json are passed', async () => {
    respondWithResumedRelease();

    await releaseResumeCommand.action(
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
    expect(harness.readJson()).toEqual(RESUMED_RELEASE);
  });

  it('should stop with E_CONFIRMATION_REQUIRED when nobody can confirm', async () => {
    respondWithResumedRelease();

    await expect(
      releaseResumeCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, release: '43' },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);

    expect(readResumeRequests()).toEqual([]);
  });
});
