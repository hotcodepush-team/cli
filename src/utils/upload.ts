import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import type { Bundle, HotCodePush } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import {
  BundleManifestSchema,
  ManifestEnvelopeSchema,
} from '@hotcodepush/protocol';
import type { BundleFile } from './bundle-files.js';
import { collectBundleFiles } from './bundle-files.js';
import type { CompressedFile } from './compressed-files.js';
import { compressFiles, withTemporaryDirectory } from './compressed-files.js';
import { BundleTooLargeError } from './errors.js';
import type { GitProvenance } from './git-provenance.js';
import { resolveFilesBaseUrl } from './hosts.js';
import { writePack } from './pack.js';
import type { Reporter } from './progress.js';
import { resolveByteText } from './progress.js';
import { readApiUrl } from './user-config.js';

export type Platform = 'android' | 'ios';

export interface UploadBundleOptions {
  appId: string;
  bundleVersion: string;
  directoryPath: string;
  gitProvenance: GitProvenance;
  platforms: Platform[];
  reporter: Reporter;
}

export interface UploadedBundle {
  bundle: Bundle;
  deltaBaseBundleId: string | null;
  uploadedBytes: number;
  uploadedFileCount: number;
}

export interface UploadedFiles {
  uploadedBytes: number;
  uploadedFileCount: number;
}

/** The one public size limit, in decimal bytes as the limits are. */
export const BUNDLE_BYTES_LIMIT = 512_000_000;

/** A file's gzip bytes go up in one request below this, in parts above it, well under a Worker's request-body cap. */
export const SINGLE_UPLOAD_LIMIT_BYTES = 64 * 1024 * 1024;

/** Every part but the last is at least five mebibytes and all are one size, the bucket's rule. */
export const PART_SIZE_BYTES = 10 * 1024 * 1024;

const MANIFEST_FETCH_TIMEOUT_MS = 30_000;

/**
 * A file or the whole build above the limit is refused before a byte is sent.
 */
export function assertWithinBundleBytesLimit(files: BundleFile[]): void {
  const largeFile = files.find(file => file.sizeBytes > BUNDLE_BYTES_LIMIT);
  if (largeFile !== undefined) {
    throw new BundleTooLargeError(largeFile.path, BUNDLE_BYTES_LIMIT);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (totalBytes > BUNDLE_BYTES_LIMIT) {
    throw new BundleTooLargeError('the bundle', BUNDLE_BYTES_LIMIT);
  }
}

/**
 * The whole upload of a web build: hash every file, post the manifest, upload only the hashes the app lacks,
 * the full pack, the delta pack against the app's previous bundle where its manifest is reachable, then complete.
 */
export async function uploadBundle(
  hotCodePush: HotCodePush,
  {
    appId,
    bundleVersion,
    directoryPath,
    gitProvenance,
    platforms,
    reporter,
  }: UploadBundleOptions,
): Promise<UploadedBundle> {
  reporter.report(`Hashing the files under ${directoryPath}…`);
  const files = await collectBundleFiles(directoryPath);
  assertWithinBundleBytesLimit(files);
  const [previousBundle] = await hotCodePush.apps.bundles.list({
    appId,
    limit: 1,
    state: 'ready',
  });
  const createdBundle = await hotCodePush.apps.bundles.create({
    appId,
    bundleVersion,
    files: files.map(({ path, sha256, sizeBytes }) => ({
      path,
      sha256,
      sizeBytes,
    })),
    fingerprint: null,
    platforms,
    ...gitProvenance,
  });
  return withTemporaryDirectory(async temporaryDirectoryPath => {
    const compressedFiles = await compressFiles(files, temporaryDirectoryPath);
    const missingSha256s = createdBundle.uploads.files.map(
      ({ sha256 }) => sha256,
    );
    reporter.report(
      `Uploading ${missingSha256s.length} of ${files.length} files the app lacks…`,
    );
    const uploadedFiles = await uploadMissingFiles(
      hotCodePush,
      appId,
      missingSha256s,
      compressedFiles,
      reporter,
    );
    const packFilePath = join(temporaryDirectoryPath, 'pack');
    await writePack(
      resolveCompressedFiles(files, compressedFiles),
      packFilePath,
    );
    reporter.report('Uploading the full pack…');
    await hotCodePush.apps.bundles.pack.upload({
      appId,
      body: await openAsBlob(packFilePath),
      bundleId: createdBundle.id,
    });
    const deltaBaseBundleId = await uploadDeltaPack(
      hotCodePush,
      appId,
      createdBundle.id,
      previousBundle,
      files,
      compressedFiles,
      temporaryDirectoryPath,
      reporter,
    );
    const completedBundle = await hotCodePush.apps.bundles.complete({
      appId,
      bundleId: createdBundle.id,
    });
    return { bundle: completedBundle, deltaBaseBundleId, ...uploadedFiles };
  });
}

/**
 * The files of the hashes given, each in one request or in parts by size, as their gzip bytes from disk.
 */
export async function uploadMissingFiles(
  hotCodePush: HotCodePush,
  appId: string,
  missingSha256s: string[],
  compressedFiles: Map<string, CompressedFile>,
  reporter: Reporter,
): Promise<UploadedFiles> {
  let uploadedBytes = 0;
  for (const [index, sha256] of missingSha256s.entries()) {
    const compressedFile = compressedFiles.get(sha256);
    if (compressedFile === undefined) {
      throw new Error(`The app lacks ${sha256}, which is not in the build.`);
    }
    reporter.report(
      `  ${index + 1}/${missingSha256s.length} ${sha256.slice(0, 12)} (${resolveByteText(compressedFile.sizeBytes)})`,
    );
    await uploadFile(hotCodePush, appId, compressedFile);
    uploadedBytes += compressedFile.sizeBytes;
  }
  return { uploadedBytes, uploadedFileCount: missingSha256s.length };
}

/**
 * The hashes the app lacks per its refusal to register: `E_UPLOAD_INCOMPLETE` names them in its details.
 */
export function resolveMissingSha256s(error: unknown): string[] | undefined {
  if (
    !(error instanceof HotCodePushError) ||
    error.code !== 'E_UPLOAD_INCOMPLETE'
  ) {
    return undefined;
  }
  const details = error.details as { missingSha256s?: unknown } | null;
  const missingSha256s = details?.missingSha256s;
  return Array.isArray(missingSha256s)
    ? missingSha256s.filter(
        (sha256): sha256 is string => typeof sha256 === 'string',
      )
    : [];
}

function resolveCompressedFiles(
  files: BundleFile[],
  compressedFiles: Map<string, CompressedFile>,
): CompressedFile[] {
  const seen = new Set<string>();
  const resolved: CompressedFile[] = [];
  for (const { sha256 } of files) {
    const compressedFile = compressedFiles.get(sha256);
    if (compressedFile !== undefined && !seen.has(sha256)) {
      seen.add(sha256);
      resolved.push(compressedFile);
    }
  }
  return resolved;
}

/**
 * The hashes a bundle's manifest lists, read from the files host; unreachable is null, and the delta is then skipped —
 * a device on that base fetches the full pack, slower, never failed.
 */
async function fetchManifestSha256s(
  appId: string,
  bundleId: string,
): Promise<Set<string> | null> {
  try {
    const response = await fetch(
      `${resolveFilesBaseUrl(readApiUrl())}/apps/${appId}/bundles/${bundleId}/manifest.json`,
      { signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS) },
    );
    if (!response.ok) {
      return null;
    }
    const envelope = ManifestEnvelopeSchema.parse(await response.json());
    const manifest = BundleManifestSchema.parse(JSON.parse(envelope.manifest));
    return new Set(manifest.files.map(({ sha256 }) => sha256));
  } catch {
    return null;
  }
}

async function uploadDeltaPack(
  hotCodePush: HotCodePush,
  appId: string,
  bundleId: string,
  previousBundle: Bundle | undefined,
  files: BundleFile[],
  compressedFiles: Map<string, CompressedFile>,
  temporaryDirectoryPath: string,
  reporter: Reporter,
): Promise<string | null> {
  if (previousBundle === undefined) {
    return null;
  }
  const previousSha256s = await fetchManifestSha256s(appId, previousBundle.id);
  if (previousSha256s === null) {
    reporter.report(
      `The previous bundle's manifest is unreachable; no delta pack against #${previousBundle.number}.`,
    );
    return null;
  }
  const changedFiles = files.filter(
    ({ sha256 }) => !previousSha256s.has(sha256),
  );
  if (changedFiles.length === 0 || changedFiles.length === files.length) {
    return null;
  }
  const deltaFilePath = join(temporaryDirectoryPath, 'delta');
  await writePack(
    resolveCompressedFiles(changedFiles, compressedFiles),
    deltaFilePath,
  );
  reporter.report(
    `Uploading the delta pack against #${previousBundle.number}, ${changedFiles.length} changed files…`,
  );
  await hotCodePush.apps.bundles.deltas.upload({
    appId,
    baseBundleId: previousBundle.id,
    body: await openAsBlob(deltaFilePath),
    bundleId,
  });
  return previousBundle.id;
}

async function uploadFile(
  hotCodePush: HotCodePush,
  appId: string,
  { compressedFilePath, sha256, sizeBytes }: CompressedFile,
): Promise<void> {
  const blob = await openAsBlob(compressedFilePath);
  if (sizeBytes <= SINGLE_UPLOAD_LIMIT_BYTES) {
    await hotCodePush.apps.files.upload({ appId, body: blob, sha256 });
    return;
  }
  const { uploadId } = await hotCodePush.apps.files.uploads.create({
    appId,
    sha256,
  });
  try {
    const parts: { etag: string; partNumber: number }[] = [];
    for (
      let start = 0, partNumber = 1;
      start < sizeBytes;
      start += PART_SIZE_BYTES, partNumber += 1
    ) {
      const uploadedPart = await hotCodePush.apps.files.uploads.parts.upload({
        appId,
        body: blob.slice(start, Math.min(start + PART_SIZE_BYTES, sizeBytes)),
        partNumber,
        sha256,
        uploadId,
      });
      parts.push(uploadedPart);
    }
    await hotCodePush.apps.files.uploads.complete({
      appId,
      parts,
      sha256,
      uploadId,
    });
  } catch (error) {
    await hotCodePush.apps.files.uploads
      .delete({ appId, sha256, uploadId })
      .catch(() => undefined);
    throw error;
  }
}
