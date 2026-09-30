import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HotCodePush, HotCodePushError } from '@hotcodepush/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  API_URL,
  respondWithApiError,
  TOKEN,
  useCommandHarness,
} from '../../test/command-harness.js';
import {
  DEMO_APP,
  PREVIOUS_BUNDLE,
  READY_BUNDLE,
} from '../../test/fixtures.js';
import { BundleTooLargeError } from './errors.js';
import {
  assertWithinBundleBytesLimit,
  BUNDLE_BYTES_LIMIT,
  PART_SIZE_BYTES,
  resolveMissingSha256s,
  SINGLE_UPLOAD_LIMIT_BYTES,
  uploadDeltaPack,
  uploadMissingFiles,
  uploadPack,
} from './upload.js';

const SHA256 = 'a'.repeat(64);

const BUNDLE_PATH = `/v1/apps/${DEMO_APP.id}/bundles/${READY_BUNDLE.id}`;

const PART_COUNT = Math.ceil((SINGLE_UPLOAD_LIMIT_BYTES + 1) / PART_SIZE_BYTES);

const PACK_UPLOADS = [
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

  function writePackFile(sizeBytes: number): string {
    const packFilePath = join(directoryPath, 'pack');
    writeFileSync(packFilePath, Buffer.alloc(sizeBytes));
    return packFilePath;
  }

  it('should upload a large file in parts of one size and complete the multipart upload', async () => {
    const sizeBytes = SINGLE_UPLOAD_LIMIT_BYTES + 1;
    const compressedFilePath = join(directoryPath, `${SHA256}.gz`);
    writeFileSync(compressedFilePath, randomBytes(sizeBytes));
    const filePath = `/v1/apps/${DEMO_APP.id}/files/${SHA256}`;
    harness.routes[`POST ${filePath}/uploads`] = () =>
      Response.json({ uploadId: 'upload-1' }, { status: 201 });
    harness.routes[`PUT ${filePath}/uploads/upload-1/parts/1`] = () =>
      Response.json({ etag: 'etag-1', partNumber: 1 });
    harness.routes[`PUT ${filePath}/uploads/upload-1/parts/7`] = () =>
      Response.json({ etag: 'etag-7', partNumber: 7 });
    for (let partNumber = 2; partNumber <= 6; partNumber += 1) {
      harness.routes[`PUT ${filePath}/uploads/upload-1/parts/${partNumber}`] =
        () => Response.json({ etag: `etag-${partNumber}`, partNumber });
    }
    harness.routes[`POST ${filePath}/uploads/upload-1/complete`] = () =>
      Response.json(
        {
          appId: DEMO_APP.id,
          createdAt: '2026-09-29T12:00:00.000Z',
          sha256: SHA256,
          sizeBytes,
        },
        { status: 201 },
      );

    const uploadedFiles = await uploadMissingFiles(
      new HotCodePush({ baseUrl: API_URL, token: TOKEN }),
      DEMO_APP.id,
      [SHA256],
      new Map([[SHA256, { compressedFilePath, sha256: SHA256, sizeBytes }]]),
      { report: () => undefined },
    );

    const partRequests = harness.requests.filter(({ url }) =>
      url.includes('/parts/'),
    );
    expect(partRequests).toHaveLength(7);
    expect(
      partRequests
        .slice(0, 6)
        .map(request => Number(request.headers.get('content-length'))),
    ).toEqual(Array.from({ length: 6 }, () => PART_SIZE_BYTES));
    expect(Number(partRequests[6]?.headers.get('content-length'))).toBe(
      sizeBytes - 6 * PART_SIZE_BYTES,
    );
    const completeRequest = harness.requests.find(({ url }) =>
      url.endsWith('/complete'),
    );
    expect(await completeRequest?.json()).toEqual({
      parts: Array.from({ length: 7 }, (_, index) => ({
        etag: `etag-${index + 1}`,
        partNumber: index + 1,
      })),
    });
    expect(uploadedFiles).toEqual({
      uploadedBytes: sizeBytes,
      uploadedFileCount: 1,
    });
  });

  it.each(PACK_UPLOADS)(
    'should upload the $kind in one request when it is at the single-upload limit',
    async ({ path, upload }) => {
      harness.routes[`PUT ${path}`] = () =>
        Response.json({ sizeBytes: SINGLE_UPLOAD_LIMIT_BYTES });

      await upload(
        new HotCodePush({ baseUrl: API_URL, token: TOKEN }),
        writePackFile(SINGLE_UPLOAD_LIMIT_BYTES),
      );

      expect(readRequestLines()).toEqual([`PUT ${path}`]);
      expect(Number(harness.requests[0]?.headers.get('content-length'))).toBe(
        SINGLE_UPLOAD_LIMIT_BYTES,
      );
    },
  );

  it.each(PACK_UPLOADS)(
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
        writePackFile(SINGLE_UPLOAD_LIMIT_BYTES + 1),
      );

      expect(readRequestLines()).toEqual([
        `POST ${path}/uploads`,
        ...Array.from(
          { length: PART_COUNT },
          (_, index) => `PUT ${path}/uploads/upload-1/parts/${index + 1}`,
        ),
        `POST ${path}/uploads/upload-1/complete`,
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

  it.each(PACK_UPLOADS)(
    'should delete the multipart upload of the $kind when a part fails',
    async ({ path, upload }) => {
      harness.routes[`POST ${path}/uploads`] = () =>
        Response.json({ uploadId: 'upload-1' }, { status: 201 });
      harness.routes[`PUT ${path}/uploads/upload-1/parts/1`] = () =>
        respondWithApiError(409, 'E_UPLOAD_INCOMPLETE', 'The part is refused.');
      harness.routes[`DELETE ${path}/uploads/upload-1`] = () =>
        new Response(null, { status: 204 });

      await expect(
        upload(
          new HotCodePush({ baseUrl: API_URL, token: TOKEN }),
          writePackFile(SINGLE_UPLOAD_LIMIT_BYTES + 1),
        ),
      ).rejects.toMatchObject({ code: 'E_UPLOAD_INCOMPLETE' });
      expect(readRequestLines()).toEqual([
        `POST ${path}/uploads`,
        `PUT ${path}/uploads/upload-1/parts/1`,
        `DELETE ${path}/uploads/upload-1`,
      ]);
    },
  );

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
            message: 'Objects are missing.',
          },
          409,
        ),
      ),
    ).toEqual([SHA256]);
    expect(resolveMissingSha256s(new Error('boom'))).toBeUndefined();
  });
});
