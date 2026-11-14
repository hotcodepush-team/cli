import type {
  ExtraFingerprintFile,
  FingerprintContributors,
  LockedPackage,
} from '@hotcodepush/protocol/fingerprint';
import { z } from 'zod';
import { defineCommand } from '../../utils/command.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { readFlagFile } from '../../utils/flag-file.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson, printTable } from '../../utils/output.js';
import { promptText } from '../../utils/prompts.js';

interface ExtraFingerprintPathChange {
  after: string | null;
  before: string | null;
  path: string;
}

interface FingerprintDiff {
  extraFingerprintPaths: ExtraFingerprintPathChange[];
  packages: PackageChange[];
}

type InstalledVersion = Omit<LockedPackage, 'name'>;

interface PackageChange {
  after: InstalledVersion | null;
  before: InstalledVersion | null;
  name: string;
}

const FINGERPRINT_FILE_FIX =
  'Write each file with "hotcodepush fingerprint --json > <file>", the earlier one at the commit of the store build.';

const FingerprintFileSchema = z.object({
  fingerprint: z.string(),
  extraFingerprintPaths: z.array(
    z.object({ path: z.string(), sha256: z.string() }),
  ),
  packages: z.array(
    z.object({
      integrity: z.string().nullable(),
      name: z.string(),
      version: z.string(),
    }),
  ),
});

type FingerprintFile = z.infer<typeof FingerprintFileSchema>;

export default defineCommand({
  description:
    'Print the packages and extra fingerprint paths added, removed or moved between <file-a> and <file-b>, two files written by fingerprint --json, the earlier first. Runs locally without a login.',
  authentication: 'optional',
  examples: [
    'hotcodepush fingerprint diff store-build.json current.json',
    'hotcodepush fingerprint diff store-build.json current.json --json',
  ],
  args: z.array(z.string()),
  options: defineCommandOptions({}),
  action: async (options, args) => {
    assertTwoFiles(args);
    const { afterFile, beforeFile } = await readFingerprintFiles(options, args);
    const diff = resolveFingerprintDiff(beforeFile, afterFile);
    if (options.json) {
      printJson(diff);
      return;
    }
    if (diff.packages.length === 0 && diff.extraFingerprintPaths.length === 0) {
      console.log('Nothing moved.');
      printDetails([['Fingerprint', beforeFile.fingerprint]]);
      return;
    }
    printFingerprintDiff(diff);
  },
});

function assertTwoFiles(args: string[]): void {
  if (args.length > 2) {
    throw new InvalidParameterError(
      `The fingerprint diff command compares two files, <file-a> and <file-b>. It does not take ${args.slice(2).join(' ')}.`,
    );
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function printFingerprintDiff(diff: FingerprintDiff): void {
  printTable({
    emptyText: 'No package moved.',
    headers: ['PACKAGE', 'BEFORE', 'AFTER'],
    nextOffset: null,
    rows: diff.packages.map(({ after, before, name }) => [
      name,
      resolveInstalledVersionText(before, { otherInstalledVersion: after }),
      resolveInstalledVersionText(after, { otherInstalledVersion: before }),
    ]),
  });
  if (diff.extraFingerprintPaths.length > 0) {
    console.log('');
    printTable({
      emptyText: '',
      headers: ['EXTRA FINGERPRINT PATH', 'BEFORE', 'AFTER'],
      nextOffset: null,
      rows: diff.extraFingerprintPaths.map(({ after, before, path }) => [
        path,
        before ?? 'none',
        after ?? 'none',
      ]),
    });
  }
}

function readFingerprintFile({
  argumentName,
  filePath,
}: {
  argumentName: string;
  filePath: string;
}): FingerprintFile {
  const text = readFlagFile(filePath, {
    fix: FINGERPRINT_FILE_FIX,
    flag: argumentName,
  });
  const parsedFile = FingerprintFileSchema.safeParse(parseJson(text));
  if (!parsedFile.success) {
    throw new InvalidParameterError(
      `The file ${filePath} from ${argumentName} is not a fingerprint written by fingerprint --json.`,
      { cause: parsedFile.error, fix: FINGERPRINT_FILE_FIX },
    );
  }
  return parsedFile.data;
}

async function readFingerprintFiles(
  options: InteractivityOptions,
  [beforeFilePath, afterFilePath]: string[],
): Promise<{ afterFile: FingerprintFile; beforeFile: FingerprintFile }> {
  const beforeFile = readFingerprintFile({
    argumentName: '<file-a>',
    filePath:
      beforeFilePath ??
      (await promptText(options, {
        flag: '<file-a>',
        message: "Which file holds the earlier fingerprint, the store build's?",
      })),
  });
  const afterFile = readFingerprintFile({
    argumentName: '<file-b>',
    filePath:
      afterFilePath ??
      (await promptText(options, {
        flag: '<file-b>',
        message: 'Which file holds the later fingerprint?',
      })),
  });
  return { afterFile, beforeFile };
}

function resolveExtraFingerprintPathChanges(
  before: ExtraFingerprintFile[],
  after: ExtraFingerprintFile[],
): ExtraFingerprintPathChange[] {
  const beforeHashes = new Map(
    before.map(({ path, sha256 }) => [path, sha256]),
  );
  const afterHashes = new Map(after.map(({ path, sha256 }) => [path, sha256]));
  const paths = [...new Set([...beforeHashes.keys(), ...afterHashes.keys()])];
  return paths
    .sort()
    .map(path => ({
      after: afterHashes.get(path) ?? null,
      before: beforeHashes.get(path) ?? null,
      path,
    }))
    .filter(({ after, before }) => after !== before);
}

function resolveFingerprintDiff(
  before: FingerprintContributors,
  after: FingerprintContributors,
): FingerprintDiff {
  return {
    extraFingerprintPaths: resolveExtraFingerprintPathChanges(
      before.extraFingerprintPaths,
      after.extraFingerprintPaths,
    ),
    packages: resolvePackageChanges(before.packages, after.packages),
  };
}

// Shows the integrity where the version did not move, so a rebuild under the same version shows.
function resolveInstalledVersionText(
  installedVersion: InstalledVersion | null,
  { otherInstalledVersion }: { otherInstalledVersion: InstalledVersion | null },
): string {
  if (installedVersion === null) {
    return 'none';
  }
  return installedVersion.version === otherInstalledVersion?.version
    ? (installedVersion.integrity ?? 'no integrity')
    : installedVersion.version;
}

// Pairs the versions in order: a pair moved, the rest was added or removed.
function resolvePackageChanges(
  before: LockedPackage[],
  after: LockedPackage[],
): PackageChange[] {
  const names = [...new Set([...before, ...after].map(({ name }) => name))];
  return names.sort().flatMap(name => {
    const beforeVersions = resolveVersionsOnlyIn(before, {
      name,
      otherPackages: after,
    });
    const afterVersions = resolveVersionsOnlyIn(after, {
      name,
      otherPackages: before,
    });
    return Array.from(
      { length: Math.max(beforeVersions.length, afterVersions.length) },
      (_, index) => ({
        after: afterVersions[index] ?? null,
        before: beforeVersions[index] ?? null,
        name,
      }),
    );
  });
}

function resolveVersionsOnlyIn(
  packages: LockedPackage[],
  { name, otherPackages }: { name: string; otherPackages: LockedPackage[] },
): InstalledVersion[] {
  return packages
    .filter(
      locked =>
        locked.name === name &&
        !otherPackages.some(
          other =>
            other.name === name &&
            other.version === locked.version &&
            other.integrity === locked.integrity,
        ),
    )
    .map(({ integrity, version }) => ({ integrity, version }));
}
