import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { writeBsdiffPatch } from './bsdiff.js';
import type { BundleFile } from './bundle-files.js';
import type { CompressedFile } from './compressed-files.js';
import type { DeltaBase } from './delta-bases.js';
import type { MainBundlePathResolver } from './frameworks/index.js';
import { resolveFilesBaseUrl } from './hosts.js';
import type { Reporter } from './progress.js';
import { resolveByteText } from './progress.js';
import type { Platform } from './upload.js';
import { readApiUrl } from './user-config.js';

/**
 * A patch a delta pack carries, from the file `fromSha256` to the file `toSha256`, with the file its bytes lie in.
 */
export interface ComputedPatch {
  fromSha256: string;
  patchFilePath: string;
  sizeBytes: number;
  toSha256: string;
}

/**
 * A base's main bundle and the new bundle's, paired by their role, where their contents differ.
 */
export interface PatchPair {
  fromSha256: string;
  toFile: BundleFile;
}

export interface ComputePatchesOptions {
  appId: string;
  compressedFiles: Map<string, CompressedFile>;
  pairs: PatchPair[];
  reporter: Reporter;
  temporaryDirectoryPath: string;
}

const BASE_FILE_FETCH_TIMEOUT_MS = 60_000;

const PATCH_CONCURRENCY = 3;

/**
 * The main bundles to patch against a base, one per platform the two share where the framework names a main bundle in
 * both and its content changed; none against a base whose delta pack carries the whole file.
 */
export function resolvePatchPairs(
  base: DeltaBase,
  files: BundleFile[],
  platforms: Platform[],
  resolveMainBundlePath: MainBundlePathResolver | undefined,
): PatchPair[] {
  if (!base.isPatchable || resolveMainBundlePath === undefined) {
    return [];
  }
  return platforms
    .filter(platform => base.platforms.includes(platform))
    .flatMap(platform => {
      const toPath = resolveMainBundlePath(files, platform);
      const fromPath = resolveMainBundlePath(base.files, platform);
      const toFile = files.find(({ path }) => path === toPath);
      const fromFile = base.files.find(({ path }) => path === fromPath);
      return toFile === undefined ||
        fromFile === undefined ||
        fromFile.sha256 === toFile.sha256
        ? []
        : [{ fromSha256: fromFile.sha256, toFile }];
    });
}

/**
 * The patches of the pairs, each pair once and three at a time, each from the base's bytes fetched by hash from the
 * files host; a patch is kept when it is smaller than the stored object it replaces. A base that cannot be fetched and
 * a diff that fails each mean the file moves whole, said in one line — a patchless delta pack, never a failed upload.
 */
export async function computePatches({
  appId,
  compressedFiles,
  pairs,
  reporter,
  temporaryDirectoryPath,
}: ComputePatchesOptions): Promise<ComputedPatch[]> {
  const uniquePairs = [
    ...new Map(
      pairs.map(pair => [`${pair.fromSha256}/${pair.toFile.sha256}`, pair]),
    ).values(),
  ];
  const computedPatches: (ComputedPatch | undefined)[] = [];
  // the diff runs on this thread, so three at a time overlaps the fetches of the bases
  const remainingPairs = uniquePairs.entries();
  await Promise.all(
    Array.from({ length: PATCH_CONCURRENCY }, async () => {
      for (const [index, { fromSha256, toFile }] of remainingPairs) {
        try {
          const computedPatch = await computePatch(
            appId,
            fromSha256,
            toFile,
            temporaryDirectoryPath,
          );
          const storedSizeBytes =
            compressedFiles.get(toFile.sha256)?.sizeBytes ?? toFile.sizeBytes;
          if (computedPatch.sizeBytes < storedSizeBytes) {
            reporter.report(
              `Patched ${toFile.path} from ${fromSha256.slice(0, 12)}: ${resolveByteText(computedPatch.sizeBytes)} in place of ${resolveByteText(storedSizeBytes)}.`,
            );
            computedPatches[index] = computedPatch;
          }
        } catch (error) {
          reporter.report(
            `No patch for ${toFile.path} from ${fromSha256.slice(0, 12)}, which moves whole: ${error instanceof Error ? error.message : String(error)}.`,
          );
        }
      }
    }),
  );
  return computedPatches.filter(patch => patch !== undefined);
}

async function computePatch(
  appId: string,
  fromSha256: string,
  toFile: BundleFile,
  temporaryDirectoryPath: string,
): Promise<ComputedPatch> {
  const baseFilePath = join(temporaryDirectoryPath, `${fromSha256}.base`);
  await fetchBaseFile(appId, fromSha256, baseFilePath);
  const patchFilePath = join(
    temporaryDirectoryPath,
    `${fromSha256}-${toFile.sha256}.patch`,
  );
  await writeBsdiffPatch(baseFilePath, toFile.filePath, patchFilePath);
  return {
    fromSha256,
    patchFilePath,
    sizeBytes: (await stat(patchFilePath)).size,
    toSha256: toFile.sha256,
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
