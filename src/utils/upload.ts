import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import type { Bundle, HotCodePush } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import { BUNDLE_BYTES_LIMIT, signManifest } from '@hotcodepush/protocol';
import type { ManifestToSign } from '@hotcodepush/protocol';
import type { BundleFile } from './bundle-files.js';
import { collectBundleFiles } from './bundle-files.js';
import type { CompressedFile } from './compressed-files.js';
import { compressFiles, withTemporaryDirectory } from './compressed-files.js';
import { BundleTooLargeError } from './errors.js';
import { omitNativeGlue } from './frameworks/native-glue.js';
import type { GitProvenance } from './git-provenance.js';
import { resolveQuantityText } from './output.js';
import { writePack } from './pack.js';
import { fetchAllPages } from './pagination.js';
import type { Reporter } from './progress.js';
import { resolveByteText } from './progress.js';

export type Platform = 'android' | 'ios';

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
    throw new BundleTooLargeError(
      `The file ${largeFile.path}`,
      BUNDLE_BYTES_LIMIT,
    );
  }
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (totalBytes > BUNDLE_BYTES_LIMIT) {
    throw new BundleTooLargeError('The bundle', BUNDLE_BYTES_LIMIT);
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
      `Left out ${resolveQuantityText(omittedFileCount, 'file')} of the native glue the binary carries: ${nativeGluePaths.join(', ')}.`,
    );
  }
  return files;
}

export async function uploadBundle(
  hotCodePush: HotCodePush,
  {
    appId,
    bundleVersion,
    directoryPath,
    fingerprint,
    gitProvenance,
    nativeGluePaths,
    platforms,
    reporter,
    signingPrivateKey,
  }: UploadBundleOptions,
): Promise<UploadedBundle> {
  reporter.report(`Hashing the files under ${directoryPath}…`);
  const files = await collectUploadFiles({
    directoryPath,
    nativeGluePaths,
    reporter,
  });
  assertWithinBundleBytesLimit(files);
  return withTemporaryDirectory(async temporaryDirectoryPath => {
    const compressedFiles = await compressFiles(files, temporaryDirectoryPath);
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
    const createdBundle = await hotCodePush.apps.bundles.create({
      appId,
      files: manifest.files,
      fingerprint,
      platforms: manifest.platforms,
      signature,
      version: bundleVersion,
      ...gitProvenance,
    });
    const missingSha256s = await fetchMissingSha256s(hotCodePush, {
      appId,
      bundleId: createdBundle.id,
    });
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
    await writePack([...compressedFiles.values()], packFilePath);
    reporter.report('Uploading the full pack…');
    await uploadPack(
      hotCodePush,
      { appId, bundleId: createdBundle.id },
      packFilePath,
    );
    const completedBundle = await hotCodePush.apps.bundles.complete({
      appId,
      bundleId: createdBundle.id,
    });
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
  appId: string,
  missingSha256s: string[],
  compressedFiles: Map<string, CompressedFile>,
  reporter: Reporter,
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
    await uploadFile(hotCodePush, appId, compressedFile);
    sizeBytes += compressedFile.sizeBytes;
  }
  return { fileCount: missingSha256s.length, sizeBytes };
}

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

// Several paths can share a hash, so each is listed once.
async function fetchMissingSha256s(
  hotCodePush: HotCodePush,
  pathParameters: { appId: string; bundleId: string },
): Promise<string[]> {
  const missingFiles = await fetchAllPages(
    page =>
      hotCodePush.apps.bundles.files.list({
        ...pathParameters,
        isStored: 'false',
        ...page,
      }),
    BUNDLE_FILE_PAGE_LIMIT,
  );
  return [...new Set(missingFiles.map(({ sha256 }) => sha256))];
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
