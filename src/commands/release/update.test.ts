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
import { MissingParameterError } from '../../utils/errors.js';
import releaseUpdateCommand from './update.js';

vi.mock('@clack/prompts');

describe('release update', () => {
  const harness = useCommandHarness();

  function readUpdateRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'PATCH');
  }

  it('should change the mandatory flag and the notes once confirmed with what changes', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithStagingReleases(harness);
    harness.routes[`PATCH ${RELEASES_PATH}/${LIVE_RELEASE.id}`] = () =>
      Response.json({ ...LIVE_RELEASE, isMandatory: true, notes: 'hotfix' });

    await releaseUpdateCommand.action(
      {
        config: harness.writeProjectConfig({
          appId: DEMO_APP.id,
          channelId: STAGING_CHANNEL.id,
        }),
        mandatory: true,
        notes: 'hotfix',
        release: '43',
      },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This changes release #43 of staging, mandatory on and notes "hotfix": devices see the change on their next check. Continue?',
    });
    const [updateRequest] = readUpdateRequests();
    expect(await updateRequest?.json()).toEqual({
      isMandatory: true,
      notes: 'hotfix',
    });
    expect(harness.readLines()).toEqual([
      `Updated release #43 of staging (${LIVE_RELEASE.id}).`,
    ]);
  });

  it('should clear the mandatory flag with --mandatory false and print the release as JSON when --yes and --json are passed', async () => {
    respondWithStagingReleases(harness);
    harness.routes[`PATCH ${RELEASES_PATH}/${LIVE_RELEASE.id}`] = () =>
      Response.json(LIVE_RELEASE);

    await releaseUpdateCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        json: true,
        mandatory: false,
        release: LIVE_RELEASE.id,
        yes: true,
      },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    const [updateRequest] = readUpdateRequests();
    expect(await updateRequest?.json()).toEqual({ isMandatory: false });
    expect(harness.readJson()).toEqual(LIVE_RELEASE);
  });

  it('should refuse to run without a change to make', async () => {
    await expect(
      releaseUpdateCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, release: '43' },
        undefined,
      ),
    ).rejects.toBeInstanceOf(MissingParameterError);

    expect(harness.requests).toEqual([]);
  });
});
