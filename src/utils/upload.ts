import { openAsBlob } from 'node:fs';
import { join } from 'node:path';
import type { Bundle, BundleWithUploads, HotCodePush } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import { signManifest } from '@hotcodepush/protocol';
import type { ManifestToSign } from '@hotcodepush/protocol';
import type { BundleFile } from './bundle-files.js';
import { collectBundleFiles } from './bundle-files.js';
import type { CompressedFile } from './compressed-files.js';
import { compressFiles, withTemporaryDirectory } from './compressed-files.js';
import type { DeltaBase } from './delta-bases.js';
import { fetchDeltaBases } from './delta-bases.js';
import { BundleTooLargeError } from './errors.js';
import type { MainBundlePathResolver } from './frameworks/index.js';
import type { GitProvenance } from './git-provenance.js';
import { writePack } from './pack.js';
import type { ComputedPatch, PatchPair } from './patches.js';
import { computePatches, resolvePatchPairs } from './patches.js';
import type { Reporter } from './progress.js';
import { resolveByteText } from './progress.js';

export type Platform = 'android' | 'ios';

export interface UploadBundleOptions {
  appId: string;
  bundleVersion: string;
  directoryPath: string;
  fingerprint: string;
  gitProvenance: GitProvenance;
  platforms: Platform[];
  reporter: Reporter;
  /** The framework's main bundle among the files, which delta packs carry as a patch; none without the framework's member. */
  resolveMainBundlePath?: MainBundlePathResolver;
  /** The private key the manifest is signed with, the base64 of its PKCS #8 DER; null where signing is off. */
  signingPrivateKey: string | null;
}

export interface UploadedBundle {
  bundle: Bundle;
  /** The bases a delta pack was uploaded against, earlier bundles first, then binaries' embedded bundles. */
  deltaBaseBundleIds: string[];
  /** The delta packs that carry the main bundle as a patch. */
  patchCount: number;
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
 * The whole upload of a web build: hash every file, find the delta bases and patch the main bundle against the newest
 * earlier bundle and the binaries, sign the manifest where a key is configured, post it, upload only the hashes the app
 * lacks, the full pack, one delta pack per base, then complete.
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
    resolveMainBundlePath,
    signingPrivateKey,
  }: UploadBundleOptions,
): Promise<UploadedBundle> {
  reporter.report(`Hashing the files under ${directoryPath}…`);
  const files = await collectBundleFiles(directoryPath);
  assertWithinBundleBytesLimit(files);
  const deltaBases = await fetchDeltaBases(hotCodePush, {
    appId,
    fingerprint,
    platforms,
  });
  return withTemporaryDirectory(async temporaryDirectoryPath => {
    const compressedFiles = await compressFiles(files, temporaryDirectoryPath);
    const patchPairsByBase = new Map(
      deltaBases.map(base => [
        base,
        resolvePatchPairs(base, files, platforms, resolveMainBundlePath),
      ]),
    );
    const computedPatches = await computePatches({
      appId,
      compressedFiles,
      pairs: [...patchPairsByBase.values()].flat(),
      reporter,
      temporaryDirectoryPath,
    });
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
    const packFiles = resolveCompressedFiles(files, compressedFiles);
    const packFilePath = join(temporaryDirectoryPath, 'pack');
    await writePack(packFiles, [], packFilePath);
    reporter.report('Uploading the full pack…');
    await uploadPack(
      hotCodePush,
      { appId, bundleId: createdBundle.id },
      packFilePath,
    );
    const uploadedDeltaPacks = await uploadDeltaPacks(hotCodePush, {
      appId,
      bundleId: createdBundle.id,
      computedPatches,
      packFiles,
      patchPairsByBase,
      reporter,
      temporaryDirectoryPath,
    });
    const completedBundle = await hotCodePush.apps.bundles.complete({
      appId,
      bundleId: createdBundle.id,
    });
    return {
      bundle: completedBundle,
      ...uploadedDeltaPacks,
      ...uploadedFiles,
      warnings: createdBundle.warnings,
    };
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
 * What a delta pack against a base carries: the files whose contents the base lacks, and the patches in place of the
 * files they make. None for a base it would give every file, nor for one that holds them all.
 */
export function resolveDeltaPack(
  base: DeltaBase,
  packFiles: CompressedFile[],
  patches: ComputedPatch[],
): { files: CompressedFile[]; patches: ComputedPatch[] } | undefined {
  const baseSha256s = new Set(base.files.map(({ sha256 }) => sha256));
  const patchedSha256s = new Set(patches.map(({ toSha256 }) => toSha256));
  const changedFiles = packFiles.filter(
    ({ sha256 }) => !baseSha256s.has(sha256) && !patchedSha256s.has(sha256),
  );
  if (
    changedFiles.length === packFiles.length ||
    (changedFiles.length === 0 && patches.length === 0)
  ) {
    return undefined;
  }
  return { files: changedFiles, patches };
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

function compareCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
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
 * The computed patches of a base's pairs; a pair whose patch failed or saved nothing moves its file whole.
 */
function resolvePairedPatches(
  patchPairs: PatchPair[],
  computedPatches: ComputedPatch[],
): ComputedPatch[] {
  return computedPatches.filter(patch =>
    patchPairs.some(
      pair =>
        pair.fromSha256 === patch.fromSha256 &&
        pair.toFile.sha256 === patch.toSha256,
    ),
  );
}

/**
 * One delta pack per base it is worth one to, in the bases' order: the files the base lacks and the main bundle's patch
 * where one was made against it.
 */
async function uploadDeltaPacks(
  hotCodePush: HotCodePush,
  {
    appId,
    bundleId,
    computedPatches,
    packFiles,
    patchPairsByBase,
    reporter,
    temporaryDirectoryPath,
  }: {
    appId: string;
    bundleId: string;
    computedPatches: ComputedPatch[];
    packFiles: CompressedFile[];
    patchPairsByBase: Map<DeltaBase, PatchPair[]>;
    reporter: Reporter;
    temporaryDirectoryPath: string;
  },
): Promise<Pick<UploadedBundle, 'deltaBaseBundleIds' | 'patchCount'>> {
  const deltaBaseBundleIds: string[] = [];
  let patchCount = 0;
  for (const [base, patchPairs] of patchPairsByBase) {
    const deltaPack = resolveDeltaPack(
      base,
      packFiles,
      resolvePairedPatches(patchPairs, computedPatches),
    );
    if (deltaPack === undefined) {
      continue;
    }
    const deltaPackFilePath = join(
      temporaryDirectoryPath,
      `delta-${base.bundleId}`,
    );
    await writePack(deltaPack.files, deltaPack.patches, deltaPackFilePath);
    reporter.report(
      `Uploading the delta pack against ${base.label}, ${deltaPack.files.length} changed files${deltaPack.patches.length === 0 ? '' : ' and the main bundle as a patch'}…`,
    );
    await uploadDeltaPack(
      hotCodePush,
      { appId, baseBundleId: base.bundleId, bundleId },
      deltaPackFilePath,
    );
    deltaBaseBundleIds.push(base.bundleId);
    patchCount += deltaPack.patches.length === 0 ? 0 : 1;
  }
  return { deltaBaseBundleIds, patchCount };
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
