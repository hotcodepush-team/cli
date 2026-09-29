import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildPack } from '@hotcodepush/protocol';
import type { PackEntry } from '@hotcodepush/protocol';
import type { CompressedFile } from './compressed-files.js';

/**
 * A pack written to disk through the protocol's writer: the entries' gzip bytes in the order given, named by their hashes.
 */
export async function writePack(
  entries: CompressedFile[],
  outputFilePath: string,
): Promise<void> {
  await pipeline(
    Readable.fromWeb(buildPack(readPackEntries(entries))),
    createWriteStream(outputFilePath),
  );
}

async function* readPackEntries(
  entries: CompressedFile[],
): AsyncIterable<PackEntry> {
  for (const { compressedFilePath, sha256, sizeBytes } of entries) {
    yield {
      body: Readable.toWeb(
        createReadStream(compressedFilePath),
      ) as ReadableStream<Uint8Array>,
      sha256,
      sizeBytes,
    };
  }
}
