import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  PREVIOUS_BUNDLE,
  READY_BUNDLE,
} from '../../../test/fixtures.js';
import bundleListCommand from './list.js';

const BUNDLES_PATH = `/v1/apps/${DEMO_APP.id}/bundles`;

describe('bundle list', () => {
  const harness = useCommandHarness();

  function readListQuery(): Record<string, string> {
    const listUrl = harness.requests
      .map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === BUNDLES_PATH);
    return Object.fromEntries(listUrl?.searchParams ?? []);
  }

  it('should list the uploaded bundles, their numbers prefixed', async () => {
    harness.routes[`GET ${BUNDLES_PATH}`] = () =>
      Response.json([READY_BUNDLE, PREVIOUS_BUNDLE]);

    await bundleListCommand.action({ app: DEMO_APP.id }, undefined);

    expect(readListQuery()).toEqual({ type: 'uploaded' });
    expect(harness.readLines()).toEqual([
      'NUMBER  VERSION  STATE  PLATFORMS    SIZE      CREATED',
      '#17     1.4.2    ready  android,ios  812.3 kB  2026-09-05',
      '#16     1.4.1    ready  android,ios  812.3 kB  2026-09-04',
    ]);
  });

  it('should filter by the version label and print JSON with the next offset', async () => {
    harness.routes[`GET ${BUNDLES_PATH}`] = () =>
      Response.json([PREVIOUS_BUNDLE]);

    await bundleListCommand.action(
      { app: DEMO_APP.id, bundleVersion: '1.4.1', json: true, limit: 1 },
      undefined,
    );

    expect(readListQuery()).toEqual({
      limit: '1',
      type: 'uploaded',
      version: '1.4.1',
    });
    expect(harness.readJson()).toEqual({
      bundles: [PREVIOUS_BUNDLE],
      nextOffset: 1,
    });
  });
});
