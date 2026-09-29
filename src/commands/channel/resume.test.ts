import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../testing/command-harness.js';
import {
  DEMO_APP,
  STAGING_CHANNEL,
  STAGING_CHANNEL_WITH_DEVICE_COUNTS,
} from '../../testing/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import channelResumeCommand from './resume.js';

vi.mock('@clack/prompts');

const CHANNEL_PATH = `/v1/apps/${DEMO_APP.id}/channels/${STAGING_CHANNEL.id}`;

describe('channel resume', () => {
  const harness = useCommandHarness();

  function readResumeRequests(): Request[] {
    return harness.requests.filter(({ url }) => url.endsWith('/resume'));
  }

  function respondWithChannel(): void {
    harness.routes[`GET ${CHANNEL_PATH}`] = () =>
      Response.json({
        ...STAGING_CHANNEL_WITH_DEVICE_COUNTS,
        pausedAt: '2026-09-29T12:00:00.000Z',
      });
    harness.routes[`POST ${CHANNEL_PATH}/resume`] = () =>
      Response.json(STAGING_CHANNEL);
  }

  it('should resume the channel once confirmed, stating that devices receive its releases again', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithChannel();

    await channelResumeCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.id },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This resumes channel staging: devices receive its releases again. Continue?',
    });
    expect(readResumeRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Resumed channel staging (${STAGING_CHANNEL.id}).`,
    ]);
  });

  it('should resume nothing when the confirmation is declined', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithChannel();

    await channelResumeCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.id },
      undefined,
    );

    expect(readResumeRequests()).toEqual([]);
    expect(harness.readLines()).toEqual([]);
  });

  it('should resume without asking and print the channel as JSON when --yes and --json are passed', async () => {
    respondWithChannel();

    await channelResumeCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        json: true,
        yes: true,
      },
      undefined,
    );

    expect(harness.readJson()).toEqual(STAGING_CHANNEL);
  });

  it('should throw E_CONFIRMATION_REQUIRED and resume nothing when nobody can be asked', async () => {
    respondWithChannel();

    await expect(
      channelResumeCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, json: true },
        undefined,
      ),
    ).rejects.toThrow(ConfirmationRequiredError);
    expect(readResumeRequests()).toEqual([]);
  });
});
