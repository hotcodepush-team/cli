import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../test/command-harness.js';
import { DEMO_APP } from '../../test/fixtures.js';
import type { BundleFile } from './bundle-files.js';
import { compressFiles } from './compressed-files.js';
import type { ComputedPatch } from './patches.js';
import { computePatches, PATCH_FLOOR_BYTES } from './patches.js';

// A script of 2,000 lines, well above the floor, and the same with one line changed
const BASE_SCRIPT = Buffer.from(
  Array.from({ length: 2000 }, (_, line) => `console.log(${line});\n`).join(''),
);
const NEXT_SCRIPT = Buffer.from(
  BASE_SCRIPT.toString().replace('console.log(1000);', 'console.log("v2");'),
);

function computeSha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

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

  async function computePatchesAgainst(
    file: BundleFile,
    baseFiles: { path: string; sha256: string }[],
  ): Promise<ComputedPatch[]> {
    return computePatches({
      appId: DEMO_APP.id,
      baseFiles: baseFiles.map(baseFile => ({ ...baseFile, sizeBytes: 1 })),
      compressedFiles: await compressFiles([file], temporaryDirectoryPath),
      files: [file],
      reporter: { report: line => reports.push(line) },
      temporaryDirectoryPath,
    });
  }

  it('should patch a large file that changed from the bytes of its base, fetched by hash from the files host', async () => {
    const baseSha256 = computeSha256(BASE_SCRIPT);
    respondWithBaseFile(BASE_SCRIPT, baseSha256);
    const file = writeBundleFile('app.js', NEXT_SCRIPT);

    const [patch] = await computePatchesAgainst(file, [
      { path: 'app.js', sha256: baseSha256 },
    ]);

    expect(patch).toMatchObject({
      format: 'bsdiff',
      fromSha256: baseSha256,
      path: 'app.js',
      toSha256: file.sha256,
    });
    const patchBytes = readFileSync(patch?.patchFilePath ?? '');
    expect(patchBytes.subarray(0, 8).toString()).toBe('BSDIFF40');
    expect(patch?.sizeBytes).toBe(patchBytes.length);
    expect(reports).toEqual([
      expect.stringMatching(/^Patched app\.js: \d+ B in place of /),
    ]);
  });

  it.each([
    [
      'when the file is under the floor',
      Buffer.alloc(PATCH_FLOOR_BYTES - 1, 'a'),
      [{ path: 'app.js', sha256: 'b'.repeat(64) }],
    ],
    [
      'when the base lists the path with the same content',
      NEXT_SCRIPT,
      [{ path: 'app.js', sha256: computeSha256(NEXT_SCRIPT) }],
    ],
    [
      'when the base does not list the path',
      NEXT_SCRIPT,
      [{ path: 'other.js', sha256: 'b'.repeat(64) }],
    ],
  ])(
    'should compute no patch and fetch nothing %s',
    async (_condition, content, baseFiles) => {
      const file = writeBundleFile('app.js', content);

      expect(await computePatchesAgainst(file, baseFiles)).toEqual([]);
      expect(harness.requests).toHaveLength(0);
    },
  );

  it('should leave out a patch above the cap, the file that shares nothing with its base', async () => {
    const baseContent = randomBytes(PATCH_FLOOR_BYTES * 2);
    const baseSha256 = computeSha256(baseContent);
    respondWithBaseFile(baseContent, baseSha256);
    const file = writeBundleFile('app.js', randomBytes(PATCH_FLOOR_BYTES * 2));

    expect(
      await computePatchesAgainst(file, [
        { path: 'app.js', sha256: baseSha256 },
      ]),
    ).toEqual([]);
    expect(reports).toEqual([]);
  });

  it('should move the file whole and say why when the files host does not answer its base', async () => {
    const file = writeBundleFile('app.js', NEXT_SCRIPT);

    expect(
      await computePatchesAgainst(file, [
        { path: 'app.js', sha256: computeSha256(BASE_SCRIPT) },
      ]),
    ).toEqual([]);
    expect(reports).toEqual([
      'No patch for app.js, which moves whole: the files host answered 404 for its base.',
    ]);
  });

  it('should move the file whole when the files host answers other bytes than its base', async () => {
    const baseSha256 = computeSha256(BASE_SCRIPT);
    respondWithBaseFile(Buffer.from('tampered'), baseSha256);
    const file = writeBundleFile('app.js', NEXT_SCRIPT);

    expect(
      await computePatchesAgainst(file, [
        { path: 'app.js', sha256: baseSha256 },
      ]),
    ).toEqual([]);
    expect(reports).toEqual([
      'No patch for app.js, which moves whole: the files host answered other bytes than its base.',
    ]);
  });
});
