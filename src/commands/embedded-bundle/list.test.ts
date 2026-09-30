import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { DEMO_APP, EMBEDDED_BUNDLE } from '../../../test/fixtures.js';
import embeddedBundleListCommand from './list.js';

describe('embedded-bundle list', () => {
  const harness = useCommandHarness();

  it('should list the registered store builds with their identity', async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/embedded-bundles`] = () =>
      Response.json([EMBEDDED_BUNDLE]);

    await embeddedBundleListCommand.action({ app: DEMO_APP.id }, undefined);

    expect(harness.readLines()).toEqual([
      'ID                                    PLATFORM  VERSION  BUILD  FINGERPRINT  CREATED',
      `${EMBEDDED_BUNDLE.id}  ios       1.0      1      none         2026-09-06`,
    ]);
  });

  it('should print JSON with the next offset', async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/embedded-bundles`] = () =>
      Response.json([]);

    await embeddedBundleListCommand.action(
      { app: DEMO_APP.id, json: true },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      embeddedBundles: [],
      nextOffset: null,
    });
  });
});
