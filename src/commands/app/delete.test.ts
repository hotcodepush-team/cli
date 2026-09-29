import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../testing/command-harness.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  STAGING_CHANNEL,
} from '../../testing/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import appDeleteCommand from './delete.js';

vi.mock('@clack/prompts');

describe('app delete', () => {
  const harness = useCommandHarness();

  function readDeleteRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'DELETE');
  }

  function respondWithAppAndChannels(): void {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json(DEMO_APP);
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/channels`] = () =>
      Response.json([STAGING_CHANNEL, PRODUCTION_CHANNEL]);
    harness.routes[`DELETE /v1/apps/${DEMO_APP.id}`] = () =>
      new Response(null, { status: 204 });
  }

  it('should delete the app once confirmed, stating the channels that go with it', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithAppAndChannels();

    await appDeleteCommand.action({ app: DEMO_APP.id }, undefined);

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message: 'This deletes app Demo and its 2 channels. Continue?',
    });
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([`Deleted app Demo (${DEMO_APP.id}).`]);
  });

  it('should delete without asking and print an empty object when --yes and --json are passed', async () => {
    respondWithAppAndChannels();

    await appDeleteCommand.action(
      { app: DEMO_APP.id, json: true, yes: true },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readJson()).toEqual({});
  });

  it('should throw E_CONFIRMATION_REQUIRED and delete nothing when nobody can be asked', async () => {
    respondWithAppAndChannels();

    await expect(
      appDeleteCommand.action({ app: DEMO_APP.id }, undefined),
    ).rejects.toThrow(
      new ConfirmationRequiredError('deletes app Demo and its 2 channels'),
    );
    expect(readDeleteRequests()).toEqual([]);
  });
});
