import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  STAGING_CHANNEL,
  STAGING_CHANNEL_WITH_DEVICE_COUNTS,
} from '../../../test/fixtures.js';
import {
  ConfirmationRequiredError,
  UnknownNameError,
} from '../../utils/errors.js';
import channelDeleteCommand from './delete.js';

vi.mock('@clack/prompts');

const CHANNEL_PATH = `/v1/apps/${DEMO_APP.id}/channels/${STAGING_CHANNEL.id}`;

describe('channel delete', () => {
  const harness = useCommandHarness();

  function readDeleteRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'DELETE');
  }

  function respondWithChannels(channels: object[]): void {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/channels`] = () =>
      Response.json(channels);
    harness.routes[`GET ${CHANNEL_PATH}`] = () =>
      Response.json(STAGING_CHANNEL_WITH_DEVICE_COUNTS);
    harness.routes[`DELETE ${CHANNEL_PATH}`] = () =>
      new Response(null, { status: 204 });
  }

  it('should delete the channel once confirmed, stating what happens to its devices', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithChannels([STAGING_CHANNEL, PRODUCTION_CHANNEL]);

    await channelDeleteCommand.action(
      { app: DEMO_APP.id, channel: 'staging' },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This deletes channel staging and its releases: devices on it keep what they have. Continue?',
    });
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Deleted channel staging (${STAGING_CHANNEL.id}).`,
    ]);
  });

  it('should throw E_CONFIRMATION_REQUIRED and delete nothing when nobody can be asked', async () => {
    respondWithChannels([STAGING_CHANNEL]);

    await expect(
      channelDeleteCommand.action(
        { app: DEMO_APP.id, channel: 'staging', json: true },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        'deletes channel staging and its releases: devices on it keep what they have',
      ),
    );
    expect(readDeleteRequests()).toEqual([]);
  });

  it('should throw E_INVALID_PARAMETER when no channel carries the name', async () => {
    respondWithChannels([PRODUCTION_CHANNEL]);

    await expect(
      channelDeleteCommand.action(
        { app: DEMO_APP.id, channel: 'staging', yes: true },
        undefined,
      ),
    ).rejects.toThrow(UnknownNameError);
  });

  it('should succeed without deleting when --ignore-not-found is passed and no channel carries the name', async () => {
    respondWithChannels([PRODUCTION_CHANNEL]);

    await channelDeleteCommand.action(
      { app: DEMO_APP.id, channel: 'staging', ignoreNotFound: true, yes: true },
      undefined,
    );

    expect(readDeleteRequests()).toEqual([]);
    expect(harness.readLines()).toEqual([
      'The channel does not exist; nothing to delete.',
    ]);
  });

  it('should print the id given with a null name when --ignore-not-found and --json are passed and the API does not know the id', async () => {
    await channelDeleteCommand.action(
      {
        app: DEMO_APP.id,
        channel: STAGING_CHANNEL.id,
        ignoreNotFound: true,
        json: true,
        yes: true,
      },
      undefined,
    );

    expect(harness.readJson()).toEqual({ id: STAGING_CHANNEL.id, name: null });
  });

  it('should print the id and name of the deleted channel when --yes and --json are passed', async () => {
    respondWithChannels([STAGING_CHANNEL]);
    harness.routes[
      `DELETE /v1/apps/${DEMO_APP.id}/channels/${STAGING_CHANNEL.id}`
    ] = () => new Response(null, { status: 204 });

    await channelDeleteCommand.action(
      { app: DEMO_APP.id, channel: 'staging', json: true, yes: true },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      id: STAGING_CHANNEL.id,
      name: 'staging',
    });
  });
});
