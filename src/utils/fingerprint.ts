import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectReader } from '@hotcodepush/protocol/fingerprint';
import {
  computeFingerprint,
  FingerprintError,
  resolveFingerprintContributors,
} from '@hotcodepush/protocol/fingerprint';
import { FingerprintUnavailableError } from './errors.js';

/** What the file system answers for a path that holds nothing of the kind asked for. */
const ABSENT_ERROR_CODES = new Set(['EISDIR', 'ENOENT', 'ENOTDIR']);

/**
 * The project's `fp1` fingerprint, the native contract's hash, from its committed lockfile and installed packages.
 */
export async function readFingerprint(
  projectDirectoryPath: string,
): Promise<string> {
  try {
    return computeFingerprint(
      await resolveFingerprintContributors({
        nativeSourcePaths: [],
        reader: createProjectReader(projectDirectoryPath),
      }),
    );
  } catch (error) {
    if (error instanceof FingerprintError) {
      throw new FingerprintUnavailableError(error);
    }
    throw error;
  }
}

function createProjectReader(projectDirectoryPath: string): ProjectReader {
  return {
    readDirectory: path =>
      readAbsentAsNull(async () =>
        (
          await readdir(join(projectDirectoryPath, path), {
            withFileTypes: true,
          })
        ).map(entry => ({
          isDirectory: entry.isDirectory(),
          name: entry.name,
        })),
      ),
    readFile: path =>
      readAbsentAsNull(() => readFile(join(projectDirectoryPath, path))),
  };
}

async function readAbsentAsNull<TValue>(
  read: () => Promise<TValue>,
): Promise<TValue | null> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      ABSENT_ERROR_CODES.has(String(error.code))
    ) {
      return null;
    }
    throw error;
  }
}
