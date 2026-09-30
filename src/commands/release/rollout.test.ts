import { confirm, text } from '@clack/prompts';
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
import releaseRolloutCommand from './rollout.js';

vi.mock('@clack/prompts');

const ROLLED_OUT_RELEASE = { ...LIVE_RELEASE, rolloutPercentage: 20 };

describe('release rollout', () => {
  const harness = useCommandHarness();

  function respondWithRolledOutRelease(): void {
    respondWithStagingReleases(harness);
    harness.routes[`PATCH ${RELEASES_PATH}/${LIVE_RELEASE.id}`] = () =>
      Response.json(ROLLED_OUT_RELEASE);
  }

  it('should set the rollout percentage once confirmed, stating that devices already on the release keep it', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithRolledOutRelease();

    await releaseRolloutCommand.action(
      {
        config: harness.writeProjectConfig({
          appId: DEMO_APP.id,
          channelId: STAGING_CHANNEL.id,
        }),
        release: '43',
        rolloutPercentage: 20,
      },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This sets release #43 of staging to 20 percent: devices already on it keep it, and no new device above 20 percent gets it. Continue?',
    });
    const updateRequest = harness.requests.find(
      ({ method }) => method === 'PATCH',
    );
    expect(await updateRequest?.json()).toEqual({ rolloutPercentage: 20 });
    expect(harness.readLines()).toEqual([
      'Set release #43 of staging to 20 percent.',
    ]);
  });

  it('should set the percentage without asking and print the release as JSON when --yes and --json are passed', async () => {
    respondWithRolledOutRelease();

    await releaseRolloutCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        json: true,
        release: LIVE_RELEASE.id,
        rolloutPercentage: 20,
        yes: true,
      },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(harness.readJson()).toEqual(ROLLED_OUT_RELEASE);
  });

  it('should ask for the percentage when the flag is missing and someone can answer', async () => {
    stubInteractiveTerminal();
    vi.mocked(text).mockResolvedValue('20');
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithRolledOutRelease();

    await releaseRolloutCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, release: '43' },
      undefined,
    );

    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Which share of devices should the release reach, 0 to 100?',
      }),
    );
    const updateRequest = harness.requests.find(
      ({ method }) => method === 'PATCH',
    );
    expect(await updateRequest?.json()).toEqual({ rolloutPercentage: 20 });
  });

  it('should name the flag with E_MISSING_PARAMETER when it is missing and nobody can answer', async () => {
    respondWithRolledOutRelease();

    await expect(
      releaseRolloutCommand.action(
        {
          app: DEMO_APP.id,
          channel: STAGING_CHANNEL.id,
          release: '43',
          yes: true,
        },
        undefined,
      ),
    ).rejects.toMatchObject({
      code: 'E_MISSING_PARAMETER',
      message: '--rollout-percentage is missing',
    });
  });
});
