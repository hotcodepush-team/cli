import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ManifestFile } from '@hotcodepush/protocol';
import { writeBsdiffPatch } from './bsdiff.js';
import type { BundleFile } from './bundle-files.js';
import type { CompressedFile } from './compressed-files.js';
import { resolveFilesBaseUrl } from './hosts.js';
import type { Reporter } from './progress.js';
import { resolveByteText } from './progress.js';
import { readApiUrl } from './user-config.js';

/**
 * A patch as the bundle lists it, with the file its bytes lie in until they are uploaded.
 */
export interface ComputedPatch {
  format: string;
  fromSha256: string;
  patchFilePath: string;
  path: string;
  sizeBytes: number;
  toSha256: string;
}

export interface ComputePatchesOptions {
  appId: string;
  /** The files of the bundle devices come from, as its manifest lists them. */
  baseFiles: ManifestFile[];
  compressedFiles: Map<string, CompressedFile>;
  files: BundleFile[];
  reporter: Reporter;
  temporaryDirectoryPath: string;
}

const BASE_FILE_FETCH_TIMEOUT_MS = 60_000;

/** A patch above this share of the file's stored bytes saves too little to be worth a device's work. */
export const PATCH_CAP_RATIO = 0.7;

/** A file below this size moves whole; in decimal bytes, as the limits are. */
export const PATCH_FLOOR_BYTES = 16_000;

const PATCH_FORMAT = 'bsdiff';

/**
 * The patches of the files that changed against a base bundle: a file of the floor's size or more whose path the base
 * lists with other content, patched from the base's bytes, which are fetched by hash from the files host.
 * A base that cannot be fetched, a diff that fails and a patch above the cap each mean that file moves whole —
 * a patchless upload, never a failed one.
 */
export async function computePatches({
  appId,
  baseFiles,
  compressedFiles,
  files,
  reporter,
  temporaryDirectoryPath,
}: ComputePatchesOptions): Promise<ComputedPatch[]> {
  const baseSha256sByPath = new Map(
    baseFiles.map(({ path, sha256 }) => [path, sha256]),
  );
  const computedPatches: ComputedPatch[] = [];
  for (const file of files) {
    const baseSha256 = baseSha256sByPath.get(file.path);
    if (
      baseSha256 === undefined ||
      baseSha256 === file.sha256 ||
      file.sizeBytes < PATCH_FLOOR_BYTES
    ) {
      continue;
    }
    try {
      const computedPatch = await computePatch(
        appId,
        file,
        baseSha256,
        temporaryDirectoryPath,
      );
      const storedSizeBytes =
        compressedFiles.get(file.sha256)?.sizeBytes ?? file.sizeBytes;
      if (computedPatch.sizeBytes > storedSizeBytes * PATCH_CAP_RATIO) {
        continue;
      }
      reporter.report(
        `Patched ${file.path}: ${resolveByteText(computedPatch.sizeBytes)} in place of ${resolveByteText(storedSizeBytes)}.`,
      );
      computedPatches.push(computedPatch);
    } catch (error) {
      reporter.report(
        `No patch for ${file.path}, which moves whole: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }
  return computedPatches;
}

async function computePatch(
  appId: string,
  file: BundleFile,
  baseSha256: string,
  temporaryDirectoryPath: string,
): Promise<ComputedPatch> {
  const baseFilePath = join(temporaryDirectoryPath, `${baseSha256}.base`);
  await fetchBaseFile(appId, baseSha256, baseFilePath);
  const patchFilePath = join(
    temporaryDirectoryPath,
    `${baseSha256}-${file.sha256}.patch`,
  );
  await writeBsdiffPatch(baseFilePath, file.filePath, patchFilePath);
  return {
    format: PATCH_FORMAT,
    fromSha256: baseSha256,
    patchFilePath,
    path: file.path,
    sizeBytes: (await stat(patchFilePath)).size,
    toSha256: file.sha256,
  };
}

/**
 * A file of the app by its hash, from the files host to disk, never held in memory; bytes that do not hash to the name
 * they were asked by are no base to patch from.
 */
async function fetchBaseFile(
  appId: string,
  sha256: string,
  outputFilePath: string,
): Promise<void> {
  const response = await fetch(
    `${resolveFilesBaseUrl(readApiUrl())}/apps/${appId}/files/${sha256}`,
    { signal: AbortSignal.timeout(BASE_FILE_FETCH_TIMEOUT_MS) },
  );
  if (!response.ok || response.body === null) {
    throw new Error(`the files host answered ${response.status} for its base`);
  }
  const hash = createHash('sha256');
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(outputFilePath),
  );
  if (hash.digest('hex') !== sha256) {
    throw new Error('the files host answered other bytes than its base');
  }
}
