import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildPack } from '@hotcodepush/protocol';
import type { PackEntry } from '@hotcodepush/protocol';
import type { CompressedFile } from './compressed-files.js';

/**
 * A pack written to disk through the protocol's writer: the files' gzip bytes named by their hashes, in the order given.
 */
export async function writePack(
  files: CompressedFile[],
  outputFilePath: string,
): Promise<void> {
  await pipeline(
    Readable.fromWeb(buildPack(readPackEntries(files))),
    createWriteStream(outputFilePath),
  );
}

async function* readPackEntries(
  files: CompressedFile[],
): AsyncIterable<PackEntry> {
  for (const { compressedFilePath, sha256, sizeBytes } of files) {
    yield {
      body: readBody(compressedFilePath),
      sha256,
      sizeBytes,
      type: 'file',
    };
  }
}

function readBody(filePath: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(
    createReadStream(filePath),
  ) as ReadableStream<Uint8Array>;
}
