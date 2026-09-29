import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../testing/command-harness.js';
import { DEMO_APP, READY_BUNDLE } from '../../testing/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import bundleDeleteCommand from './delete.js';

vi.mock('@clack/prompts');

const BUNDLES_PATH = `/v1/apps/${DEMO_APP.id}/bundles`;

describe('bundle delete', () => {
  const harness = useCommandHarness();

  it('should delete the bundle named by its number once confirmed', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    harness.routes[`GET ${BUNDLES_PATH}?limit=100&offset=0`] = () =>
      Response.json([READY_BUNDLE]);
    harness.routes[`DELETE ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
      new Response(null, { status: 204 });

    await bundleDeleteCommand.action(
      { app: DEMO_APP.id, bundle: '17' },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This deletes bundle #17 · 1.4.2 and its files now, not by retention. Continue?',
    });
    expect(harness.readLines()).toEqual([
      `Deleted bundle #17 · 1.4.2 (${READY_BUNDLE.id}).`,
    ]);
  });

  it('should refuse without --yes when not interactive', async () => {
    harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
      Response.json(READY_BUNDLE);

    await expect(
      bundleDeleteCommand.action(
        { app: DEMO_APP.id, bundle: READY_BUNDLE.id },
        undefined,
      ),
    ).rejects.toThrow(ConfirmationRequiredError);
  });

  it("should pass the API's E_BUNDLE_IN_USE through", async () => {
    harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
      Response.json(READY_BUNDLE);
    harness.routes[`DELETE ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
      respondWithApiError(
        409,
        'E_BUNDLE_IN_USE',
        'A release still serves the bundle.',
      );

    await expect(
      bundleDeleteCommand.action(
        { app: DEMO_APP.id, bundle: READY_BUNDLE.id, json: true, yes: true },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'E_BUNDLE_IN_USE' });
  });
});
