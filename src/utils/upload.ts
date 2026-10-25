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
  /** The native glue the files leave out, as the framework names it; none without the framework's member. */
  nativeGluePaths?: readonly string[];
  platforms: Platform[];
  reporter: Reporter;
  /** The private key the manifest is signed with, the base64 of its PKCS #8 DER; null where signing is off. */
  signingPrivateKey: string | null;
}

export interface UploadedBundle {
  bundle: Bundle;
  upload: UploadedFiles;
}

/**
 * What an upload moved: the files the app lacked and the size of their gzip copies.
 */
export interface UploadedFiles {
  fileCount: number;
  sizeBytes: number;
}

/**
 * The page a bundle's files are read in, the most that list takes, beyond every other list's.
 */
const BUNDLE_FILE_PAGE_LIMIT = 1000;

/**
 * A file or the whole build above the limit is refused before a byte is sent.
 */
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

/**
 * The files of a build an upload packages: every shipped file but the native glue the binary carries, left out with one
 * line saying so.
 */
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

/**
 * The whole upload of a web build: hash every file, sign the manifest where a key is configured, post it, read the
 * bundle's files the app's store lacks, upload those and the full pack, then complete.
 */
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

/**
 * The manifest as the API rebuilds it from the bundle's rows before it checks the signature: the files by path and the
 * platforms sorted, each by UTF-16 code units, the order canonical JSON leaves to the writer.
 */
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
 * The hashes the app lacks per its refusal to create the bundle or the binary: `upload_incomplete` names them in its details.
 */
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

/**
 * The hashes of the bundle's files not yet stored, each once, though several paths may carry one.
 */
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
