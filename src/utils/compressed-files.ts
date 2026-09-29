import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { BundleFile } from './bundle-files.js';

/**
 * A file's stored form: its gzip bytes in a temporary file, the size the upload declares as `Content-Length`.
 */
export interface CompressedFile {
  compressedFilePath: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * The gzip bytes of every file, written under one temporary directory and never held in memory, keyed by the content hash.
 */
export async function compressFiles(
  files: BundleFile[],
  temporaryDirectoryPath: string,
): Promise<Map<string, CompressedFile>> {
  const compressedFiles = new Map<string, CompressedFile>();
  for (const file of files) {
    if (compressedFiles.has(file.sha256)) {
      continue;
    }
    const compressedFilePath = join(
      temporaryDirectoryPath,
      `${file.sha256}.gz`,
    );
    await pipeline(
      createReadStream(file.filePath),
      createGzip(),
      createWriteStream(compressedFilePath),
    );
    compressedFiles.set(file.sha256, {
      compressedFilePath,
      sha256: file.sha256,
      sizeBytes: (await stat(compressedFilePath)).size,
    });
  }
  return compressedFiles;
}

/**
 * Runs a task with a temporary directory of its own, gone when the task ends however it ends.
 */
export async function withTemporaryDirectory<TResult>(
  task: (temporaryDirectoryPath: string) => Promise<TResult>,
): Promise<TResult> {
  const temporaryDirectoryPath = await mkdtemp(join(tmpdir(), 'hotcodepush-'));
  try {
    return await task(temporaryDirectoryPath);
  } finally {
    await rm(temporaryDirectoryPath, { force: true, recursive: true });
  }
}
