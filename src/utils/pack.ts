import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildPack } from '@hotcodepush/protocol';
import type { PackEntry } from '@hotcodepush/protocol';
import type { CompressedFile } from './compressed-files.js';
import type { ComputedPatch } from './patches.js';

/**
 * A pack written to disk through the protocol's writer: the files' gzip bytes named by their hashes, then the patches
 * named by the hashes of the files they turn one into the other, each in the order given.
 */
export async function writePack(
  files: CompressedFile[],
  patches: ComputedPatch[],
  outputFilePath: string,
): Promise<void> {
  await pipeline(
    Readable.fromWeb(buildPack(readPackEntries(files, patches))),
    createWriteStream(outputFilePath),
  );
}

async function* readPackEntries(
  files: CompressedFile[],
  patches: ComputedPatch[],
): AsyncIterable<PackEntry> {
  for (const { compressedFilePath, sha256, sizeBytes } of files) {
    yield {
      body: readBody(compressedFilePath),
      sha256,
      sizeBytes,
      type: 'file',
    };
  }
  for (const { fromSha256, patchFilePath, sizeBytes, toSha256 } of patches) {
    yield {
      body: readBody(patchFilePath),
      fromSha256,
      sizeBytes,
      toSha256,
      type: 'patch',
    };
  }
}

function readBody(filePath: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    createReadStream(filePath),
  ) as ReadableStream<Uint8Array>;
}
