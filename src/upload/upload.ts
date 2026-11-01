import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import type { Bundle, HotCodePush } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import { BUNDLE_BYTES_LIMIT, signManifest } from '@hotcodepush/protocol';
import type { ManifestToSign } from '@hotcodepush/protocol';
import { omitNativeGlue } from '../frameworks/native-glue.js';
import { BundleTooLargeError } from '../utils/errors.js';
import { resolveQuantityText, resolveByteText } from '../utils/output.js';
import { fetchAllPages } from '../utils/pagination.js';
import type { Reporter } from '../utils/progress.js';
import type { BundleFile } from './bundle-files.js';
import { collectBundleFiles } from './bundle-files.js';
import type { CompressedFile } from './compressed-files.js';
import { compressFiles, withTemporaryDirectory } from './compressed-files.js';
import type { GitProvenance } from './git-provenance.js';
import { writePack } from './pack.js';

export type Platform = 'android' | 'ios';

export const PLATFORMS: Platform[] = ['android', 'ios'];

interface BundleIds {
  appId: string;
  bundleId: string;
}

export interface UploadBundleOptions {
  appId: string;
  bundleVersion: string;
  directoryPath: string;
  fingerprint: string;
  gitProvenance: GitProvenance;
  nativeGluePaths?: readonly string[];
  platforms: Platform[];
  reporter: Reporter;
  // Base64 of the PKCS #8 DER, or null when signing is off.
  signingPrivateKey: string | null;
}

export interface UploadedBundle {
  bundle: Bundle;
  upload: UploadedFiles;
}

export interface UploadedFiles {
  fileCount: number;
  sizeBytes: number;
}

// The most the bundle files list takes, more than any other list.
const BUNDLE_FILE_PAGE_LIMIT = 1000;

export function assertWithinBundleBytesLimit(files: BundleFile[]): void {
  const largeFile = files.find(file => file.sizeBytes > BUNDLE_BYTES_LIMIT);
  if (largeFile !== undefined) {
    throw new BundleTooLargeError(`The file ${largeFile.path}`);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (totalBytes > BUNDLE_BYTES_LIMIT) {
    throw new BundleTooLargeError('The bundle');
  }
}

export async function collectUploadFiles({
  directoryPath,
  nativeGluePaths = [],
  reporter,
}: Pick<
  UploadBundleOptions,
  'directoryPath' | 'nativeGluePaths' | 'reporter'
>): Promise<BundleFile[]> {
  const collectedFiles = await collectBundleFiles(directoryPath);
  const files = omitNativeGlue(collectedFiles, nativeGluePaths);
  const omittedFileCount = collectedFiles.length - files.length;
  if (omittedFileCount > 0) {
    reporter.report(
      `Left out ${resolveQuantityText(omittedFileCount, { noun: 'file' })} of the native glue the binary carries: ${nativeGluePaths.join(', ')}.`,
    );
  }
  return files;
}

export async function uploadBundle(
  hotCodePush: HotCodePush,
  options: UploadBundleOptions,
): Promise<UploadedBundle> {
  options.reporter.report(`Hashing the files under ${options.directoryPath}…`);
  const files = await collectUploadFiles(options);
  assertWithinBundleBytesLimit(files);
  return withTemporaryDirectory(async temporaryDirectoryPath => {
    const compressedFiles = await compressFiles(files, temporaryDirectoryPath);
    const createdBundle = await createSignedBundle(hotCodePush, {
      ...options,
      files,
    });
    const bundleIds = { appId: options.appId, bundleId: createdBundle.id };
    const uploadedFiles = await uploadFilesTheAppLacks(hotCodePush, {
      bundleIds,
      compressedFiles,
      fileCount: files.length,
      reporter: options.reporter,
    });
    await uploadFullPack(hotCodePush, {
      bundleIds,
      compressedFiles,
      reporter: options.reporter,
      temporaryDirectoryPath,
    });
    const completedBundle = await hotCodePush.apps.bundles.complete(bundleIds);
    return { bundle: completedBundle, upload: uploadedFiles };
  });
}

// The API rebuilds this manifest before it checks the signature, so the order must match.
// Canonical JSON leaves array order to the writer: files sort by path and platforms by UTF-16 code units.
export function buildManifestToSign({
  appId,
  bundleVersion,
  files,
  fingerprint,
  platforms,
}: Pick<
  UploadBundleOptions,
  'appId' | 'bundleVersion' | 'fingerprint' | 'platforms'
> & {
  files: BundleFile[];
}): ManifestToSign & { platforms: Platform[] } {
  return {
    appId,
    bundleVersion,
    files: files
      .map(({ path, sha256, sizeBytes }) => ({ path, sha256, sizeBytes }))
      .sort((left, right) => compareCodeUnits(left.path, right.path)),
    fingerprint,
    platforms: [...platforms].sort(compareCodeUnits),
  };
}

export async function uploadMissingFiles(
  hotCodePush: HotCodePush,
  {
    appId,
    compressedFiles,
    missingSha256s,
    reporter,
  }: {
    appId: string;
    compressedFiles: Map<string, CompressedFile>;
    missingSha256s: string[];
    reporter: Reporter;
  },
): Promise<UploadedFiles> {
  let sizeBytes = 0;
  for (const [index, sha256] of missingSha256s.entries()) {
    const compressedFile = compressedFiles.get(sha256);
    if (compressedFile === undefined) {
      throw new Error(`The app lacks ${sha256}, which is not in the build.`);
    }
    reporter.report(
      `  ${index + 1}/${missingSha256s.length} ${sha256.slice(0, 12)} (${resolveByteText(compressedFile.sizeBytes)})`,
    );
    await uploadFile(hotCodePush, { appId, compressedFile });
    sizeBytes += compressedFile.sizeBytes;
  }
  return { fileCount: missingSha256s.length, sizeBytes };
}

export async function uploadPack(
  hotCodePush: HotCodePush,
  { packFilePath, ...bundleIds }: BundleIds & { packFilePath: string },
): Promise<void> {
  await hotCodePush.apps.bundles.pack.upload({
    ...bundleIds,
    body: await openAsBlob(packFilePath),
  });
}

// `upload_incomplete` names the missing hashes in its details.
export function resolveMissingSha256s(error: unknown): string[] | undefined {
  if (
    !(error instanceof HotCodePushError) ||
    error.code !== 'upload_incomplete'
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

function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

async function createSignedBundle(
  hotCodePush: HotCodePush,
  {
    appId,
    bundleVersion,
    files,
    fingerprint,
    gitProvenance,
    platforms,
    reporter,
    signingPrivateKey,
  }: UploadBundleOptions & { files: BundleFile[] },
): Promise<Bundle> {
  const manifest = buildManifestToSign({
    appId,
    bundleVersion,
    files,
    fingerprint,
    platforms,
  });
  const signature =
    signingPrivateKey === null
      ? null
      : (await signManifest(manifest, signingPrivateKey)).signature;
  if (signature !== null) {
    reporter.report(`Signed the manifest with key ${signature.keyId}.`);
  }
  return hotCodePush.apps.bundles.create({
    appId,
    files: manifest.files,
    fingerprint,
    platforms: manifest.platforms,
    signature,
    version: bundleVersion,
    ...gitProvenance,
  });
}

// Several paths can share a hash, so each is listed once.
async function fetchMissingSha256s(
  hotCodePush: HotCodePush,
  bundleIds: BundleIds,
): Promise<string[]> {
  const missingFiles = await fetchAllPages(
    page =>
      hotCodePush.apps.bundles.files.list({
        ...bundleIds,
        isStored: false,
        ...page,
      }),
    BUNDLE_FILE_PAGE_LIMIT,
  );
  return [...new Set(missingFiles.map(({ sha256 }) => sha256))];
}

async function uploadFile(
  hotCodePush: HotCodePush,
  {
    appId,
    compressedFile: { compressedFilePath, sha256 },
  }: { appId: string; compressedFile: CompressedFile },
): Promise<void> {
  await hotCodePush.apps.files.upload({
    appId,
    body: await openAsBlob(compressedFilePath),
    sha256,
  });
}

async function uploadFilesTheAppLacks(
  hotCodePush: HotCodePush,
  {
    bundleIds,
    compressedFiles,
    fileCount,
    reporter,
  }: {
    bundleIds: BundleIds;
    compressedFiles: Map<string, CompressedFile>;
    fileCount: number;
    reporter: Reporter;
  },
): Promise<UploadedFiles> {
  const missingSha256s = await fetchMissingSha256s(hotCodePush, bundleIds);
  reporter.report(
    `Uploading ${missingSha256s.length} of ${fileCount} files the app lacks…`,
  );
  return uploadMissingFiles(hotCodePush, {
    appId: bundleIds.appId,
    compressedFiles,
    missingSha256s,
    reporter,
  });
}

async function uploadFullPack(
  hotCodePush: HotCodePush,
  {
    bundleIds,
    compressedFiles,
    reporter,
    temporaryDirectoryPath,
  }: {
    bundleIds: BundleIds;
    compressedFiles: Map<string, CompressedFile>;
    reporter: Reporter;
    temporaryDirectoryPath: string;
  },
): Promise<void> {
  const packFilePath = join(temporaryDirectoryPath, 'pack');
  await writePack([...compressedFiles.values()], packFilePath);
  reporter.report('Uploading the full pack…');
  await uploadPack(hotCodePush, { ...bundleIds, packFilePath });
}
