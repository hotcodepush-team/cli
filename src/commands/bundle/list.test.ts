import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  PREVIOUS_BUNDLE,
  READY_BUNDLE,
} from '../../../test/fixtures.js';
import bundleListCommand from './list.js';

describe('bundle list', () => {
  const harness = useCommandHarness();

  it('should list the bundles with their numbers prefixed', async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/bundles`] = () =>
      Response.json([READY_BUNDLE, PREVIOUS_BUNDLE]);

    await bundleListCommand.action({ app: DEMO_APP.id }, undefined);

    expect(harness.readLines()).toEqual([
      'NUMBER  VERSION  STATE  PLATFORMS    SIZE      CREATED',
      '#17     1.4.2    ready  android,ios  812.3 kB  2026-09-05',
      '#16     1.4.1    ready  android,ios  812.3 kB  2026-09-04',
    ]);
  });

  it('should filter by the version label and print JSON with the next offset', async () => {
    harness.routes[
      `GET /v1/apps/${DEMO_APP.id}/bundles?bundleVersion=1.4.1&limit=1`
    ] = () => Response.json([PREVIOUS_BUNDLE]);

    await bundleListCommand.action(
      { app: DEMO_APP.id, bundleVersion: '1.4.1', json: true, limit: 1 },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      bundles: [PREVIOUS_BUNDLE],
      nextOffset: 1,
    });
  });
});
