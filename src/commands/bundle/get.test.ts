import { describe, expect, it } from 'vitest';
import { API_URL, useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  PREVIOUS_BUNDLE,
  READY_BUNDLE,
  READY_BUNDLE_WITH_DELTA_PACKS,
} from '../../../test/fixtures.js';
import { InvalidParameterError } from '../../utils/errors.js';
import bundleGetCommand from './get.js';

const BUNDLES_PATH = `/v1/apps/${DEMO_APP.id}/bundles`;

const BUNDLE_PATH = `${BUNDLES_PATH}/${READY_BUNDLE.id}`;

const NUMBER_SEARCH_PATH = `${BUNDLES_PATH}?limit=100&offset=0&query=17`;

describe('bundle get', () => {
  const harness = useCommandHarness();

  it('should read the bundle named by its id and print it with its delta packs', async () => {
    harness.routes[`GET ${BUNDLE_PATH}`] = () =>
      Response.json(READY_BUNDLE_WITH_DELTA_PACKS);

    await bundleGetCommand.action(
      { app: DEMO_APP.id, bundle: READY_BUNDLE.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID           ${READY_BUNDLE.id}`,
      'Number       #17',
      'Type         uploaded',
      'Version      1.4.2',
      'State        ready',
      'Platforms    android, ios',
      'Size         812.3 kB',
      'Delta packs  #16: 48.2 kB, 2 patches, built; embedded: requested',
      'Fingerprint  none',
      `Commit       ${READY_BUNDLE.gitSha}`,
      'Expires      in use',
      `Created      ${READY_BUNDLE.createdAt}`,
    ]);
  });

  it('should print none for the delta packs when the read carries none', async () => {
    harness.routes[`GET ${BUNDLE_PATH}`] = () =>
      Response.json({ ...READY_BUNDLE_WITH_DELTA_PACKS, deltaPacks: [] });

    await bundleGetCommand.action(
      { app: DEMO_APP.id, bundle: READY_BUNDLE.id },
      undefined,
    );

    expect(harness.readLines()).toContain('Delta packs  none');
  });

  it("should resolve the number to its bundle's id through the list's search and read the bundle by it", async () => {
    harness.routes[`GET ${NUMBER_SEARCH_PATH}`] = () =>
      Response.json([{ ...PREVIOUS_BUNDLE, number: 117 }, READY_BUNDLE]);
    harness.routes[`GET ${BUNDLE_PATH}`] = () =>
      Response.json(READY_BUNDLE_WITH_DELTA_PACKS);

    await bundleGetCommand.action(
      { app: DEMO_APP.id, bundle: '17' },
      undefined,
    );

    expect(harness.requests.map(({ url }) => url)).toEqual([
      `${API_URL}${NUMBER_SEARCH_PATH}`,
      `${API_URL}${BUNDLE_PATH}`,
    ]);
  });

  it.each([
    ['id', READY_BUNDLE.id],
    ['number', '17'],
  ])(
    'should print the read as JSON when the bundle is named by its %s',
    async (_, bundle) => {
      harness.routes[`GET ${NUMBER_SEARCH_PATH}`] = () =>
        Response.json([READY_BUNDLE]);
      harness.routes[`GET ${BUNDLE_PATH}`] = () =>
        Response.json(READY_BUNDLE_WITH_DELTA_PACKS);

      await bundleGetCommand.action(
        { app: DEMO_APP.id, bundle, json: true },
        undefined,
      );

      expect(harness.readJson()).toEqual(READY_BUNDLE_WITH_DELTA_PACKS);
    },
  );

  it('should refuse a number the app has no bundle for', async () => {
    harness.routes[`GET ${BUNDLES_PATH}?limit=100&offset=0&query=99`] = () =>
      Response.json([{ ...READY_BUNDLE, number: 199 }]);

    await expect(
      bundleGetCommand.action({ app: DEMO_APP.id, bundle: '99' }, undefined),
    ).rejects.toThrow(InvalidParameterError);
  });
});
