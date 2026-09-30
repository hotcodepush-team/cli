import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  DEMO_APP,
  STAGING_CHANNEL,
  STAGING_CHANNEL_WITH_DEVICE_COUNTS,
} from '../../../test/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import channelPauseCommand from './pause.js';

vi.mock('@clack/prompts');

const CHANNEL_PATH = `/v1/apps/${DEMO_APP.id}/channels/${STAGING_CHANNEL.id}`;

const PAUSED_CHANNEL = {
  ...STAGING_CHANNEL,
  pausedAt: '2026-09-29T12:00:00.000Z',
};

describe('channel pause', () => {
  const harness = useCommandHarness();

  function readPauseRequests(): Request[] {
    return harness.requests.filter(({ url }) => url.endsWith('/pause'));
  }

  function respondWithChannel(): void {
    harness.routes[`GET ${CHANNEL_PATH}`] = () =>
      Response.json(STAGING_CHANNEL_WITH_DEVICE_COUNTS);
    harness.routes[`POST ${CHANNEL_PATH}/pause`] = () =>
      Response.json(PAUSED_CHANNEL);
  }

  it('should pause the channel of hotcodepush.json once confirmed, stating that devices keep what they have', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithChannel();

    await channelPauseCommand.action(
      {
        config: harness.writeProjectConfig({
          appId: DEMO_APP.id,
          channelId: STAGING_CHANNEL.id,
        }),
      },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This pauses channel staging: devices keep what they have and get nothing new. Continue?',
    });
    expect(readPauseRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Paused channel staging (${STAGING_CHANNEL.id}).`,
    ]);
  });

  it('should pause without asking and print the channel as JSON when --yes and --json are passed', async () => {
    respondWithChannel();

    await channelPauseCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        json: true,
        yes: true,
      },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(harness.readJson()).toEqual(PAUSED_CHANNEL);
  });

  it('should throw E_CONFIRMATION_REQUIRED and pause nothing when nobody can be asked', async () => {
    respondWithChannel();

    await expect(
      channelPauseCommand.action(
        { app: DEMO_APP.id, channel: STAGING_CHANNEL.id },
        undefined,
      ),
    ).rejects.toThrow(ConfirmationRequiredError);
    expect(readPauseRequests()).toEqual([]);
  });
});
