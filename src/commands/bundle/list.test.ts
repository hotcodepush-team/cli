import type { Bundle } from '@hotcodepush/node';
import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  DEMO_APP,
  PREVIOUS_BUNDLE,
  READY_BUNDLE,
} from '../../../test/fixtures.js';
import bundleListCommand from './list.js';

const BUNDLES_PATH = `/v1/apps/${DEMO_APP.id}/bundles`;

const EMBEDDED_BUNDLE: Bundle = {
  ...PREVIOUS_BUNDLE,
  id: '4d3c2b1a-0f9e-4d8c-b7a6-59483726150e',
  number: null,
  type: 'embedded',
  version: '1.0',
};

describe('bundle list', () => {
  const harness = useCommandHarness();

  function readListQuery(): Record<string, string> {
    const listUrl = harness.requests
      .map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === BUNDLES_PATH);
    return Object.fromEntries(listUrl?.searchParams ?? []);
  }

  it('should list the uploaded bundles by default, their numbers prefixed', async () => {
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

  it('should list the bundles binaries ship with --type embedded, each without a number', async () => {
    harness.routes[`GET ${BUNDLES_PATH}`] = () =>
      Response.json([EMBEDDED_BUNDLE]);

    await bundleListCommand.action(
      { app: DEMO_APP.id, type: 'embedded' },
      undefined,
    );

    expect(readListQuery()).toEqual({ type: 'embedded' });
    expect(harness.readLines()).toEqual([
      'NUMBER  VERSION  STATE  PLATFORMS    SIZE      CREATED',
      '        1.0      ready  android,ios  812.3 kB  2026-09-04',
    ]);
  });

  it('should list every bundle with --type all, sending no type, and print the embedded one as the API answers it under --json', async () => {
    harness.routes[`GET ${BUNDLES_PATH}`] = () =>
      Response.json([READY_BUNDLE, EMBEDDED_BUNDLE]);

    await bundleListCommand.action(
      { app: DEMO_APP.id, json: true, type: 'all' },
      undefined,
    );

    expect(readListQuery()).toEqual({});
    expect(harness.readJson()).toEqual({
      bundles: [READY_BUNDLE, EMBEDDED_BUNDLE],
      nextOffset: null,
    });
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
