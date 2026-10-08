import { HotCodePush } from '@hotcodepush/node';
import { describe, expect, it } from 'vitest';
import {
  API_URL,
  TOKEN,
  useCommandHarness,
} from '../../test/command-harness.js';
import {
  BINARY,
  DEMO_APP,
  PREVIOUS_BUNDLE,
  READY_BUNDLE,
} from '../../test/fixtures.js';
import { BASE_FILES_PAGE_SIZE, fetchDeltaBases } from './delta-bases.js';
import type { Platform } from './upload.js';

const APP_PATH = `/v1/apps/${DEMO_APP.id}`;

const FINGERPRINT = 'fp1:abc';

const EARLIER_BUNDLES = [
  { ...PREVIOUS_BUNDLE, id: 'earlier-1', number: 16 },
  { ...PREVIOUS_BUNDLE, id: 'earlier-2', number: 15 },
  { ...PREVIOUS_BUNDLE, id: 'earlier-3', number: 14 },
];

const BINARIES = [
  { ...BINARY, bundleId: 'embedded-ios', platform: 'ios' as const },
  { ...BINARY, bundleId: 'embedded-android', platform: 'android' as const },
];

function buildFile(path: string): {
  path: string;
  sha256: string;
  sizeBytes: number;
} {
  return { path, sha256: path.padEnd(64, '0'), sizeBytes: 1 };
}

describe('fetchDeltaBases', () => {
  const harness = useCommandHarness();

  function respondWithBases(): void {
    harness.routes[`GET ${APP_PATH}/bundles`] = () =>
      Response.json(EARLIER_BUNDLES);
    harness.routes[`GET ${APP_PATH}/binaries`] = request => {
      const platform = new URL(request.url).searchParams.get('platform');
      return Response.json(
        BINARIES.filter(
          binary => platform === null || binary.platform === platform,
        ),
      );
    };
    for (const bundleId of [
      ...EARLIER_BUNDLES.map(({ id }) => id),
      ...BINARIES.map(({ bundleId }) => bundleId),
    ]) {
      harness.routes[`GET ${APP_PATH}/bundles/${bundleId}/files`] = () =>
        Response.json([buildFile(bundleId)]);
    }
  }

  function readQuery(pathname: string): Record<string, string> | undefined {
    const request = harness.requests.find(
      ({ url }) => new URL(url).pathname === pathname,
    );
    return request && Object.fromEntries(new URL(request.url).searchParams);
  }

  async function fetchDeltaBasesFor(platforms: Platform[]) {
    return fetchDeltaBases(
      new HotCodePush({ baseUrl: API_URL, token: TOKEN }),
      {
        appId: DEMO_APP.id,
        fingerprint: FINGERPRINT,
        platforms,
      },
    );
  }

  it('should take the three newest earlier ready uploaded bundles of the fingerprint on its platform, the newest patchable, and the three newest binaries of the fingerprint on that platform', async () => {
    respondWithBases();

    const deltaBases = await fetchDeltaBasesFor(['ios']);

    expect(readQuery(`${APP_PATH}/bundles`)).toEqual({
      fingerprint: FINGERPRINT,
      limit: '3',
      platform: 'ios',
      state: 'ready',
      type: 'uploaded',
    });
    expect(readQuery(`${APP_PATH}/binaries`)).toEqual({
      fingerprint: FINGERPRINT,
      limit: '3',
      platform: 'ios',
    });
    expect(deltaBases).toEqual([
      {
        bundleId: 'earlier-1',
        files: [buildFile('earlier-1')],
        isPatchable: true,
        label: '#16 · 1.4.1',
        platforms: ['android', 'ios'],
      },
      expect.objectContaining({ bundleId: 'earlier-2', isPatchable: false }),
      expect.objectContaining({ bundleId: 'earlier-3', isPatchable: false }),
      {
        bundleId: 'embedded-ios',
        files: [buildFile('embedded-ios')],
        isPatchable: true,
        label: 'the binary ios 1.0 (1)',
        platforms: ['ios'],
      },
    ]);
  });

  it('should ask for earlier bundles and binaries of any platform when the bundle names both', async () => {
    respondWithBases();

    const deltaBases = await fetchDeltaBasesFor(['android', 'ios']);

    expect(readQuery(`${APP_PATH}/bundles`)).not.toHaveProperty('platform');
    expect(readQuery(`${APP_PATH}/binaries`)).not.toHaveProperty('platform');
    expect(deltaBases.map(({ bundleId }) => bundleId)).toEqual([
      'earlier-1',
      'earlier-2',
      'earlier-3',
      'embedded-ios',
      'embedded-android',
    ]);
  });

  it('should take only the three newest binaries, newest first, when the fingerprint has more', async () => {
    // newest first, as the API orders the binaries by when they were created
    const binaries = ['night-4', 'night-3', 'night-2', 'night-1'].map(
      (bundleId, index) => ({
        ...BINARY,
        build: String(4 - index),
        bundleId,
        createdAt: `2026-10-0${4 - index}T02:00:00.000Z`,
      }),
    );
    harness.routes[`GET ${APP_PATH}/bundles`] = () => Response.json([]);
    harness.routes[`GET ${APP_PATH}/binaries`] = request =>
      Response.json(
        binaries.slice(
          0,
          Number(new URL(request.url).searchParams.get('limit')),
        ),
      );
    for (const { bundleId } of binaries) {
      harness.routes[`GET ${APP_PATH}/bundles/${bundleId}/files`] = () =>
        Response.json([buildFile(bundleId)]);
    }

    const deltaBases = await fetchDeltaBasesFor(['ios']);

    expect(deltaBases.map(({ bundleId }) => bundleId)).toEqual([
      'night-4',
      'night-3',
      'night-2',
    ]);
    expect(
      harness.requests.some(
        ({ url }) =>
          new URL(url).pathname === `${APP_PATH}/bundles/night-1/files`,
      ),
    ).toBe(false);
  });

  it("should read a base's files page by page, a thousand at a time", async () => {
    harness.routes[`GET ${APP_PATH}/bundles`] = () =>
      Response.json([READY_BUNDLE]);
    harness.routes[`GET ${APP_PATH}/binaries`] = () => Response.json([]);
    const files = Array.from({ length: BASE_FILES_PAGE_SIZE + 1 }, (_, index) =>
      buildFile(`file-${String(index).padStart(4, '0')}`),
    );
    const filesPath = `${APP_PATH}/bundles/${READY_BUNDLE.id}/files`;
    harness.routes[`GET ${filesPath}`] = request => {
      const { searchParams } = new URL(request.url);
      const offset = Number(searchParams.get('offset'));
      return Response.json(
        files.slice(offset, offset + Number(searchParams.get('limit'))),
      );
    };

    const [deltaBase] = await fetchDeltaBasesFor(['ios']);

    expect(deltaBase?.files).toEqual(files);
    expect(
      harness.requests
        .filter(({ url }) => new URL(url).pathname === filesPath)
        .map(({ url }) => Object.fromEntries(new URL(url).searchParams)),
    ).toEqual([
      { limit: '1000', offset: '0' },
      { limit: '1000', offset: '1000' },
    ]);
  });
});
