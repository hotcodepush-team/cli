import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HotCodePush,
  HotCodePushError,
  PART_SIZE_BYTES,
  SINGLE_UPLOAD_LIMIT_BYTES,
} from '@hotcodepush/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  API_URL,
  respondWithApiError,
  TOKEN,
  useCommandHarness,
} from '../../test/command-harness.js';
import { writeNativeGlue } from '../../test/cordova-project.js';
import {
  DEMO_APP,
  PREVIOUS_BUNDLE,
  READY_BUNDLE,
} from '../../test/fixtures.js';
import type { DeltaBase } from './delta-bases.js';
import { BundleTooLargeError } from './errors.js';
import { NATIVE_GLUE_PATHS } from './frameworks/native-glue.js';
import {
  assertWithinBundleBytesLimit,
  buildManifestToSign,
  BUNDLE_BYTES_LIMIT,
  collectUploadFiles,
  resolveDeltaPack,
  resolveMissingSha256s,
  uploadDeltaPack,
  uploadMissingFiles,
  uploadPack,
} from './upload.js';

const SHA256 = 'a'.repeat(64);

const BUNDLE_PATH = `/v1/apps/${DEMO_APP.id}/bundles/${READY_BUNDLE.id}`;

const PART_COUNT = Math.ceil((SINGLE_UPLOAD_LIMIT_BYTES + 1) / PART_SIZE_BYTES);

// every kind the CLI uploads, each through its one call of the client, which picks one request or parts by size
const UPLOADS = [
  {
    kind: 'file',
    path: `/v1/apps/${DEMO_APP.id}/files/${SHA256}`,
    upload: async (hotCodePush: HotCodePush, filePath: string) => {
      await uploadMissingFiles(
        hotCodePush,
        DEMO_APP.id,
        [SHA256],
        new Map([
          [
            SHA256,
            {
              compressedFilePath: filePath,
              sha256: SHA256,
              sizeBytes: statSync(filePath).size,
            },
          ],
        ]),
        { report: () => undefined },
      );
    },
  },
  {
    kind: 'pack',
    path: `${BUNDLE_PATH}/pack`,
    upload: (hotCodePush: HotCodePush, packFilePath: string) =>
      uploadPack(
        hotCodePush,
        { appId: DEMO_APP.id, bundleId: READY_BUNDLE.id },
        packFilePath,
      ),
  },
  {
    kind: 'delta pack',
    path: `${BUNDLE_PATH}/deltas/${PREVIOUS_BUNDLE.id}`,
    upload: (hotCodePush: HotCodePush, deltaPackFilePath: string) =>
      uploadDeltaPack(
        hotCodePush,
        {
          appId: DEMO_APP.id,
          baseBundleId: PREVIOUS_BUNDLE.id,
          bundleId: READY_BUNDLE.id,
        },
        deltaPackFilePath,
      ),
  },
];

describe('upload', () => {
  const harness = useCommandHarness();
  let directoryPath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-upload-'));
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  function readRequestLines(): string[] {
    return harness.requests.map(
      ({ method, url }) => `${method} ${new URL(url).pathname}`,
    );
  }

  function writeUploadFile(sizeBytes: number): string {
    const filePath = join(directoryPath, 'upload');
    writeFileSync(filePath, Buffer.alloc(sizeBytes));
    return filePath;
  }

  it.each(UPLOADS)(
    'should upload the $kind in one request when it is at the single-upload limit',
    async ({ path, upload }) => {
      harness.routes[`PUT ${path}`] = () =>
        Response.json({ sizeBytes: SINGLE_UPLOAD_LIMIT_BYTES });

      await upload(
        new HotCodePush({ baseUrl: API_URL, token: TOKEN }),
        writeUploadFile(SINGLE_UPLOAD_LIMIT_BYTES),
      );

      expect(readRequestLines()).toEqual([`PUT ${path}`]);
      expect(Number(harness.requests[0]?.headers.get('content-length'))).toBe(
        SINGLE_UPLOAD_LIMIT_BYTES,
      );
    },
  );

  it.each(UPLOADS)(
    'should upload the $kind in parts and complete the multipart upload when it is above the single-upload limit',
    async ({ path, upload }) => {
      harness.routes[`POST ${path}/uploads`] = () =>
        Response.json({ uploadId: 'upload-1' }, { status: 201 });
      for (let partNumber = 1; partNumber <= PART_COUNT; partNumber += 1) {
        harness.routes[`PUT ${path}/uploads/upload-1/parts/${partNumber}`] =
          () => Response.json({ etag: `etag-${partNumber}`, partNumber });
      }
      harness.routes[`POST ${path}/uploads/upload-1/complete`] = () =>
        Response.json({ sizeBytes: SINGLE_UPLOAD_LIMIT_BYTES + 1 });

      await upload(
        new HotCodePush({ baseUrl: API_URL, token: TOKEN }),
        writeUploadFile(SINGLE_UPLOAD_LIMIT_BYTES + 1),
      );

      expect(readRequestLines()).toEqual([
        `POST ${path}/uploads`,
        ...Array.from(
          { length: PART_COUNT },
          (_, index) => `PUT ${path}/uploads/upload-1/parts/${index + 1}`,
        ),
        `POST ${path}/uploads/upload-1/complete`,
      ]);
      expect(
        harness.requests
          .filter(({ url }) => url.includes('/parts/'))
          .map(request => Number(request.headers.get('content-length'))),
      ).toEqual([
        ...Array.from({ length: PART_COUNT - 1 }, () => PART_SIZE_BYTES),
        SINGLE_UPLOAD_LIMIT_BYTES + 1 - (PART_COUNT - 1) * PART_SIZE_BYTES,
      ]);
      const completeRequest = harness.requests.at(-1);
      expect(await completeRequest?.json()).toEqual({
        parts: Array.from({ length: PART_COUNT }, (_, index) => ({
          etag: `etag-${index + 1}`,
          partNumber: index + 1,
        })),
      });
    },
  );

  it.each(UPLOADS)(
    'should delete the multipart upload of the $kind when a part fails',
    async ({ path, upload }) => {
      harness.routes[`POST ${path}/uploads`] = () =>
        Response.json({ uploadId: 'upload-1' }, { status: 201 });
      harness.routes[`PUT ${path}/uploads/upload-1/parts/1`] = () =>
        respondWithApiError(
          409,
          'E_UPLOAD_INCOMPLETE',
          'The parts cannot be assembled: every part but the last is at least five mebibytes and all of one size, and every part is named.',
        );
      harness.routes[`DELETE ${path}/uploads/upload-1`] = () =>
        new Response(null, { status: 204 });

      await expect(
        upload(
          new HotCodePush({ baseUrl: API_URL, token: TOKEN }),
          writeUploadFile(SINGLE_UPLOAD_LIMIT_BYTES + 1),
        ),
      ).rejects.toMatchObject({ code: 'E_UPLOAD_INCOMPLETE' });
      expect(readRequestLines()).toEqual([
        `POST ${path}/uploads`,
        `PUT ${path}/uploads/upload-1/parts/1`,
        `DELETE ${path}/uploads/upload-1`,
      ]);
    },
  );

  it('should build the manifest with the files by path and the platforms sorted by code units, as the API rebuilds it', () => {
    const file = { filePath: '/dist/a', sha256: SHA256, sizeBytes: 1 };

    expect(
      buildManifestToSign({
        appId: DEMO_APP.id,
        bundleVersion: '1.4.2',
        files: [
          { ...file, path: 'b.js' },
          { ...file, path: 'a/z.js' },
          { ...file, path: 'Z.js' },
        ],
        fingerprint: 'fp1:abc',
        platforms: ['ios', 'android'],
      }),
    ).toEqual({
      appId: DEMO_APP.id,
      bundleVersion: '1.4.2',
      files: [
        { path: 'Z.js', sha256: SHA256, sizeBytes: 1 },
        { path: 'a/z.js', sha256: SHA256, sizeBytes: 1 },
        { path: 'b.js', sha256: SHA256, sizeBytes: 1 },
      ],
      fingerprint: 'fp1:abc',
      platforms: ['android', 'ios'],
    });
  });

  describe('resolveDeltaPack', () => {
    const PACK_FILES = ['a', 'b', 'c'].map(character => ({
      compressedFilePath: `/tmp/${character}.gz`,
      sha256: character.repeat(64),
      sizeBytes: 1,
    }));
    const BASE: DeltaBase = {
      bundleId: PREVIOUS_BUNDLE.id,
      files: [{ path: 'index.html', sha256: 'a'.repeat(64), sizeBytes: 1 }],
      isPatchable: true,
      label: '#16 · 1.4.1',
      platforms: ['ios'],
    };
    const PATCH = {
      fromSha256: 'd'.repeat(64),
      patchFilePath: '/tmp/patch',
      sizeBytes: 1,
      toSha256: 'c'.repeat(64),
    };

    it('should carry the files the base lacks', () => {
      expect(resolveDeltaPack(BASE, PACK_FILES, [])).toEqual({
        files: PACK_FILES.slice(1),
        patches: [],
      });
    });

    it('should carry a patch in place of the file it makes', () => {
      expect(resolveDeltaPack(BASE, PACK_FILES, [PATCH])).toEqual({
        files: PACK_FILES.slice(1, 2),
        patches: [PATCH],
      });
    });

    it.each([
      ['when the base shares no file', { ...BASE, files: [] }],
      [
        'when the base holds every file',
        {
          ...BASE,
          files: PACK_FILES.map(({ sha256 }) => ({
            path: sha256,
            sha256,
            sizeBytes: 1,
          })),
        },
      ],
    ])('should make no delta pack %s', (_condition, base) => {
      expect(resolveDeltaPack(base, PACK_FILES, [])).toBeUndefined();
    });
  });

  describe('collectUploadFiles', () => {
    it('should leave out the native glue the framework names and say so in one line', async () => {
      writeFileSync(join(directoryPath, 'index.html'), '<h1>v1</h1>');
      writeNativeGlue(directoryPath);
      const reports: string[] = [];

      const files = await collectUploadFiles({
        directoryPath,
        nativeGluePaths: NATIVE_GLUE_PATHS,
        reporter: { report: line => reports.push(line) },
      });

      expect(files.map(({ path }) => path)).toEqual(['index.html']);
      expect(reports).toEqual([
        'Left out 3 files of the native glue the binary carries: cordova.js, cordova_plugins.js, plugins/.',
      ]);
    });

    it('should keep every file and say nothing when the framework names no native glue', async () => {
      writeFileSync(join(directoryPath, 'index.html'), '<h1>v1</h1>');
      writeNativeGlue(directoryPath);
      const reports: string[] = [];

      const files = await collectUploadFiles({
        directoryPath,
        reporter: { report: line => reports.push(line) },
      });

      expect(files).toHaveLength(4);
      expect(reports).toEqual([]);
    });
  });

  it('should refuse a file or a bundle above the one public size limit before any request', () => {
    const file = {
      filePath: '',
      path: 'video.mp4',
      sha256: SHA256,
      sizeBytes: BUNDLE_BYTES_LIMIT + 1,
    };
    expect(() => assertWithinBundleBytesLimit([file])).toThrow(
      BundleTooLargeError,
    );
    const half = { ...file, sizeBytes: BUNDLE_BYTES_LIMIT / 2 + 1 };
    expect(() =>
      assertWithinBundleBytesLimit([half, { ...half, path: 'b' }]),
    ).toThrow(BundleTooLargeError);
    expect(() => assertWithinBundleBytesLimit([half])).not.toThrow();
  });

  it("should read the hashes the API's E_UPLOAD_INCOMPLETE names, and nothing from another error", () => {
    expect(
      resolveMissingSha256s(
        new HotCodePushError(
          {
            code: 'E_UPLOAD_INCOMPLETE',
            details: { isPackMissing: false, missingSha256s: [SHA256] },
            message:
              'Objects of the bundle are missing; upload them and complete again.',
          },
          409,
        ),
      ),
    ).toEqual([SHA256]);
    expect(resolveMissingSha256s(new Error('boom'))).toBeUndefined();
  });
});
