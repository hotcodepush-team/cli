import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../testing/command-harness.js';
import { DEMO_APP, READY_BUNDLE } from '../../testing/fixtures.js';
import { InvalidParameterError } from '../../utils/errors.js';
import bundleGetCommand from './get.js';

const BUNDLES_PATH = `/v1/apps/${DEMO_APP.id}/bundles`;

describe('bundle get', () => {
  const harness = useCommandHarness();

  it('should print the bundle named by its id', async () => {
    harness.routes[`GET ${BUNDLES_PATH}/${READY_BUNDLE.id}`] = () =>
      Response.json(READY_BUNDLE);

    await bundleGetCommand.action(
      { app: DEMO_APP.id, bundle: READY_BUNDLE.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID           ${READY_BUNDLE.id}`,
      'Number       #17',
      'Version      1.4.2',
      'State        ready',
      'Platforms    android, ios',
      'Size         812.3 kB',
      'Fingerprint  none',
      `Commit       ${READY_BUNDLE.gitSha}`,
      'Expires      in use',
      `Created      ${READY_BUNDLE.createdAt}`,
    ]);
  });

  it('should find the bundle by its number in the list and print it as JSON', async () => {
    harness.routes[`GET ${BUNDLES_PATH}?limit=100&offset=0`] = () =>
      Response.json([READY_BUNDLE]);

    await bundleGetCommand.action(
      { app: DEMO_APP.id, bundle: '17', json: true },
      undefined,
    );

    expect(harness.readJson()).toEqual(READY_BUNDLE);
  });

  it('should refuse a number the app has no bundle for', async () => {
    harness.routes[`GET ${BUNDLES_PATH}?limit=100&offset=0`] = () =>
      Response.json([READY_BUNDLE]);

    await expect(
      bundleGetCommand.action({ app: DEMO_APP.id, bundle: '99' }, undefined),
    ).rejects.toThrow(InvalidParameterError);
  });
});
