import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import type { Bundle, BundleWithUploads, HotCodePush } from '@hotcodepush/node';
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
  fingerprint: string;
  gitProvenance: GitProvenance;
  platforms: Platform[];
  reporter: Reporter;
}

export interface UploadedBundle {
  bundle: Bundle;
  deltaBaseBundleId: string | null;
  uploadedBytes: number;
  uploadedFileCount: number;
  /** What the API answered beside the created bundle, the fingerprint no binary is registered with among them. */
  warnings: BundleWithUploads['warnings'];
}

export interface UploadedFiles {
  uploadedBytes: number;
  uploadedFileCount: number;
}

/** The one public size limit, in decimal bytes as the limits are. */
export const BUNDLE_BYTES_LIMIT = 512_000_000;

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
    fingerprint,
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
    fingerprint,
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
    await uploadPack(
      hotCodePush,
      { appId, bundleId: createdBundle.id },
      packFilePath,
    );
    const deltaBaseBundleId = await uploadDeltaPackAgainstPreviousBundle(
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
    return {
      bundle: completedBundle,
      deltaBaseBundleId,
      ...uploadedFiles,
      warnings: createdBundle.warnings,
    };
  });
}

/**
 * The files of the hashes given, as their gzip bytes from disk; the client puts each in one request or in parts by size.
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
 * A delta pack from disk; the client puts it in one request or in parts by size.
 */
export async function uploadDeltaPack(
  hotCodePush: HotCodePush,
  pathParameters: { appId: string; baseBundleId: string; bundleId: string },
  deltaPackFilePath: string,
): Promise<void> {
  await hotCodePush.apps.bundles.deltas.upload({
    ...pathParameters,
    body: await openAsBlob(deltaPackFilePath),
  });
}

/**
 * The full pack from disk; the client puts it in one request or in parts by size.
 */
export async function uploadPack(
  hotCodePush: HotCodePush,
  pathParameters: { appId: string; bundleId: string },
  packFilePath: string,
): Promise<void> {
  await hotCodePush.apps.bundles.pack.upload({
    ...pathParameters,
    body: await openAsBlob(packFilePath),
  });
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

async function uploadDeltaPackAgainstPreviousBundle(
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
  await uploadDeltaPack(
    hotCodePush,
    { appId, baseBundleId: previousBundle.id, bundleId },
    deltaFilePath,
  );
  return previousBundle.id;
}

async function uploadFile(
  hotCodePush: HotCodePush,
  appId: string,
  { compressedFilePath, sha256 }: CompressedFile,
): Promise<void> {
  await hotCodePush.apps.files.upload({
    appId,
    body: await openAsBlob(compressedFilePath),
    sha256,
  });
}
