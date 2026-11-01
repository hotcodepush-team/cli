import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { BundleFile } from './bundle-files.js';

export interface CompressedFile {
  compressedFilePath: string;
  sha256: string;
  sizeBytes: number;
}

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
