import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HotCodePush, HotCodePushError } from '@hotcodepush/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  API_URL,
  TOKEN,
  useCommandHarness,
} from '../../test/command-harness.js';
import { DEMO_APP } from '../../test/fixtures.js';
import { BundleTooLargeError } from './errors.js';
import {
  assertWithinBundleBytesLimit,
  BUNDLE_BYTES_LIMIT,
  PART_SIZE_BYTES,
  resolveMissingSha256s,
  SINGLE_UPLOAD_LIMIT_BYTES,
  uploadMissingFiles,
} from './upload.js';

const SHA256 = 'a'.repeat(64);

describe('upload', () => {
  const harness = useCommandHarness();
  let directoryPath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-upload-'));
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

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
