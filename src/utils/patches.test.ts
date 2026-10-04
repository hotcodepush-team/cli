import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommandHarness } from '../../test/command-harness.js';
import { DEMO_APP } from '../../test/fixtures.js';
import type * as bsdiffModule from './bsdiff.js';
import { applyBsdiffPatch, writeBsdiffPatch } from './bsdiff.js';
import type { BundleFile } from './bundle-files.js';
import { compressFiles } from './compressed-files.js';
import type { DeltaBase } from './delta-bases.js';
import type { MainBundlePathResolver } from './frameworks/index.js';
import type { ComputedPatch, PatchPair } from './patches.js';
import { computePatches, resolvePatchPairs } from './patches.js';

vi.mock('./bsdiff.js', async importOriginal => {
  const original = await importOriginal<typeof bsdiffModule>();
  return { ...original, writeBsdiffPatch: vi.fn(original.writeBsdiffPatch) };
});

// A script of 2,000 lines and the same with one line changed
const BASE_SCRIPT = Buffer.from(
  Array.from({ length: 2000 }, (_, line) => `console.log(${line});\n`).join(''),
);
const NEXT_SCRIPT = Buffer.from(
  BASE_SCRIPT.toString().replace('console.log(1000);', 'console.log("v2");'),
);

// A framework whose main bundle carries its content hash in its name, as Expo's export names it
const resolveHashedMainBundlePath: MainBundlePathResolver = (files, platform) =>
  files.find(({ path }) => path.startsWith(`${platform}/index-`))?.path;

function computeSha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('resolvePatchPairs', () => {
  const NEXT_FILE: BundleFile = {
    filePath: '/build/ios/index-next.hbc',
    path: 'ios/index-next.hbc',
    sha256: 'b'.repeat(64),
    sizeBytes: 9,
  };
  const BASE: DeltaBase = {
    bundleId: 'base-1',
    files: [
      { path: 'ios/index-base.hbc', sha256: 'a'.repeat(64), sizeBytes: 9 },
    ],
    isPatchable: true,
    label: '#16 · 1.4.1',
    platforms: ['ios'],
  };

  it("should pair the base's main bundle with the new one by their role when their names differ", () => {
    expect(
      resolvePatchPairs(
        BASE,
        [NEXT_FILE],
        ['ios'],
        resolveHashedMainBundlePath,
      ),
    ).toEqual([{ fromSha256: 'a'.repeat(64), toFile: NEXT_FILE }]);
  });

  it.each([
    [
      'when the base gets the whole file',
      { ...BASE, isPatchable: false },
      resolveHashedMainBundlePath,
    ],
    ['when the framework has no main bundle', BASE, undefined],
    [
      'when the base shares no platform',
      { ...BASE, platforms: ['android'] },
      resolveHashedMainBundlePath,
    ],
    [
      'when the main bundle did not change',
      { ...BASE, files: [{ ...NEXT_FILE, path: 'ios/index-base.hbc' }] },
      resolveHashedMainBundlePath,
    ],
    [
      'when the base holds no main bundle',
      { ...BASE, files: [] },
      resolveHashedMainBundlePath,
    ],
  ] as [string, DeltaBase, MainBundlePathResolver | undefined][])(
    'should pair nothing %s',
    (_condition, base, resolveMainBundlePath) => {
      expect(
        resolvePatchPairs(base, [NEXT_FILE], ['ios'], resolveMainBundlePath),
      ).toEqual([]);
    },
  );
});

describe('computePatches', () => {
  const harness = useCommandHarness();
  let temporaryDirectoryPath = '';
  let reports: string[] = [];

  beforeEach(() => {
    temporaryDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-patch-'));
    reports = [];
  });

  afterEach(() => {
    rmSync(temporaryDirectoryPath, { force: true, recursive: true });
  });

  function writeBundleFile(path: string, content: Buffer): BundleFile {
    const filePath = join(temporaryDirectoryPath, path);
    writeFileSync(filePath, content);
    return {
      filePath,
      path,
      sha256: computeSha256(content),
      sizeBytes: content.length,
    };
  }

  function respondWithBaseFile(content: Buffer, sha256: string): void {
    harness.routes[`GET /files/apps/${DEMO_APP.id}/files/${sha256}`] = () =>
      new Response(new Uint8Array(content));
  }

  async function computePatchesOf(
    pairs: PatchPair[],
  ): Promise<ComputedPatch[]> {
    return computePatches({
      appId: DEMO_APP.id,
      compressedFiles: await compressFiles(
        pairs.map(({ toFile }) => toFile),
        temporaryDirectoryPath,
      ),
      pairs,
      reporter: { report: line => reports.push(line) },
      temporaryDirectoryPath,
    });
  }

  it("should patch the main bundle from the base's bytes, fetched by hash from the files host, once per pair", async () => {
    const baseSha256 = computeSha256(BASE_SCRIPT);
    respondWithBaseFile(BASE_SCRIPT, baseSha256);
    const toFile = writeBundleFile('main.jsbundle', NEXT_SCRIPT);
    const pair = { fromSha256: baseSha256, toFile };

    const [patch, ...otherPatches] = await computePatchesOf([pair, pair]);

    expect(otherPatches).toEqual([]);
    expect(patch).toMatchObject({
      fromSha256: baseSha256,
      toSha256: toFile.sha256,
    });
    const patchBytes = readFileSync(patch?.patchFilePath ?? '');
    expect(patch?.sizeBytes).toBe(patchBytes.length);
    expect(applyBsdiffPatch(BASE_SCRIPT, patchBytes)).toEqual(
      new Uint8Array(NEXT_SCRIPT),
    );
    expect(harness.requests).toHaveLength(1);
    expect(reports).toEqual([
      expect.stringMatching(
        new RegExp(
          `^Patched main\\.jsbundle from ${baseSha256.slice(0, 12)}: \\d+ B in place of `,
        ),
      ),
    ]);
  });

  it('should leave out a patch that is not smaller than the stored object, the file that shares nothing with its base', async () => {
    const baseContent = randomBytes(32_000);
    const baseSha256 = computeSha256(baseContent);
    respondWithBaseFile(baseContent, baseSha256);
    const toFile = writeBundleFile('main.jsbundle', randomBytes(32_000));

    expect(
      await computePatchesOf([{ fromSha256: baseSha256, toFile }]),
    ).toEqual([]);
    expect(reports).toEqual([]);
  });

  it('should move the file whole and say why when the files host does not answer its base', async () => {
    const baseSha256 = computeSha256(BASE_SCRIPT);
    const toFile = writeBundleFile('main.jsbundle', NEXT_SCRIPT);

    expect(
      await computePatchesOf([{ fromSha256: baseSha256, toFile }]),
    ).toEqual([]);
    expect(reports).toEqual([
      `No patch for main.jsbundle from ${baseSha256.slice(0, 12)}, which moves whole: the files host answered 404 for its base.`,
    ]);
  });

  it('should move the file whole when the files host answers other bytes than its base', async () => {
    const baseSha256 = computeSha256(BASE_SCRIPT);
    respondWithBaseFile(Buffer.from('tampered'), baseSha256);
    const toFile = writeBundleFile('main.jsbundle', NEXT_SCRIPT);

    expect(
      await computePatchesOf([{ fromSha256: baseSha256, toFile }]),
    ).toEqual([]);
    expect(reports).toEqual([
      `No patch for main.jsbundle from ${baseSha256.slice(0, 12)}, which moves whole: the files host answered other bytes than its base.`,
    ]);
  });

  it('should move the file whole and say why when the diff fails', async () => {
    const baseSha256 = computeSha256(BASE_SCRIPT);
    respondWithBaseFile(BASE_SCRIPT, baseSha256);
    const toFile = writeBundleFile('main.jsbundle', NEXT_SCRIPT);
    vi.mocked(writeBsdiffPatch).mockRejectedValueOnce(
      new RangeError('out of memory'),
    );

    expect(
      await computePatchesOf([{ fromSha256: baseSha256, toFile }]),
    ).toEqual([]);
    expect(reports).toEqual([
      `No patch for main.jsbundle from ${baseSha256.slice(0, 12)}, which moves whole: out of memory.`,
    ]);
  });

  it('should compute every pair when there are more than three', async () => {
    const toFile = writeBundleFile('main.jsbundle', NEXT_SCRIPT);
    const pairs = Array.from({ length: 5 }, (_, line) => {
      const baseContent = Buffer.from(
        BASE_SCRIPT.toString().replace(`console.log(${line});`, 'base'),
      );
      const baseSha256 = computeSha256(baseContent);
      respondWithBaseFile(baseContent, baseSha256);
      return { fromSha256: baseSha256, toFile };
    });

    const patches = await computePatchesOf(pairs);

    expect(patches.map(({ fromSha256 }) => fromSha256)).toEqual(
      pairs.map(({ fromSha256 }) => fromSha256),
    );
  });
});
