import type { Binary } from '@hotcodepush/node';
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

/**
 * A binary of the fingerprint's, created on the day given, so a list of them sorts as the API sorts it.
 */
function buildBinary(
  bundleId: string,
  platform: Platform,
  createdOn: string,
): Binary {
  return {
    ...BINARY,
    bundleId,
    createdAt: `${createdOn}T02:00:00.000Z`,
    platform,
  };
}

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
    respondWithBinaries(BINARIES);
    for (const { id } of EARLIER_BUNDLES) {
      respondWithBaseFiles(id);
    }
  }

  /**
   * The binaries list as the API answers it: on the platform asked for, newest first, at most the limit.
   */
  function respondWithBinaries(binaries: Binary[]): void {
    harness.routes[`GET ${APP_PATH}/binaries`] = request => {
      const { searchParams } = new URL(request.url);
      const platform = searchParams.get('platform');
      return Response.json(
        binaries
          .filter(binary => platform === null || binary.platform === platform)
          .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, Number(searchParams.get('limit'))),
      );
    };
    for (const { bundleId } of binaries) {
      respondWithBaseFiles(bundleId);
    }
  }

  function respondWithBaseFiles(bundleId: string): void {
    harness.routes[`GET ${APP_PATH}/bundles/${bundleId}/files`] = () =>
      Response.json([buildFile(bundleId)]);
  }

  function readQueries(pathname: string): Record<string, string>[] {
    return harness.requests
      .filter(({ url }) => new URL(url).pathname === pathname)
      .map(({ url }) => Object.fromEntries(new URL(url).searchParams));
  }

  function readQuery(pathname: string): Record<string, string> | undefined {
    return readQueries(pathname)[0];
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

  it('should ask for earlier bundles of any platform and for the binaries of each platform when the bundle names both', async () => {
    respondWithBases();

    const deltaBases = await fetchDeltaBasesFor(['android', 'ios']);

    expect(readQuery(`${APP_PATH}/bundles`)).not.toHaveProperty('platform');
    expect(readQueries(`${APP_PATH}/binaries`)).toEqual([
      { fingerprint: FINGERPRINT, limit: '3', platform: 'android' },
      { fingerprint: FINGERPRINT, limit: '3', platform: 'ios' },
    ]);
    expect(deltaBases.map(({ bundleId }) => bundleId)).toEqual([
      'earlier-1',
      'earlier-2',
      'earlier-3',
      'embedded-android',
      'embedded-ios',
    ]);
  });

  it('should take only the three newest binaries, newest first, when the fingerprint has more', async () => {
    harness.routes[`GET ${APP_PATH}/bundles`] = () => Response.json([]);
    respondWithBinaries([
      buildBinary('night-1', 'ios', '2026-10-01'),
      buildBinary('night-2', 'ios', '2026-10-02'),
      buildBinary('night-3', 'ios', '2026-10-03'),
      buildBinary('night-4', 'ios', '2026-10-04'),
    ]);

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

  it("should take the three newest binaries of each platform when the bundle names both and the newest three are all one platform's", async () => {
    harness.routes[`GET ${APP_PATH}/bundles`] = () => Response.json([]);
    respondWithBinaries([
      buildBinary('android-1', 'android', '2026-10-01'),
      buildBinary('android-2', 'android', '2026-10-02'),
      buildBinary('android-3', 'android', '2026-10-03'),
      buildBinary('android-4', 'android', '2026-10-04'),
      buildBinary('ios-1', 'ios', '2026-10-05'),
      buildBinary('ios-2', 'ios', '2026-10-06'),
      buildBinary('ios-3', 'ios', '2026-10-07'),
    ]);

    const deltaBases = await fetchDeltaBasesFor(['android', 'ios']);

    expect(deltaBases.map(({ bundleId }) => bundleId)).toEqual([
      'android-4',
      'android-3',
      'android-2',
      'ios-3',
      'ios-2',
      'ios-1',
    ]);
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
