import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FingerprintContributors } from '@hotcodepush/protocol/fingerprint';
import { computeFingerprint } from '@hotcodepush/protocol/fingerprint';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import type { FingerprintFixture } from '../../../test/protocol-fixtures.js';
import { readFingerprintFixtures } from '../../../test/protocol-fixtures.js';
import fingerprintDiffCommand from './diff.js';

const FINGERPRINT_FIXTURES = readFingerprintFixtures();

/** How the workspace fixtures' names end, one per lockfile format, yarn's two included. */
const MONOREPO_NAME_ENDINGS = [
  'in an npm monorepo',
  'in a pnpm monorepo',
  'in a yarn classic monorepo',
  'in a yarn berry monorepo',
];

describe('fingerprint diff', () => {
  const harness = useCommandHarness();
  let directoryPath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-fingerprints-'));
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  function findFixture(name: string): FingerprintFixture {
    const fixture = FINGERPRINT_FIXTURES.cases.find(
      fixtureCase => fixtureCase.name === name,
    );
    if (fixture === undefined) {
      throw new Error(`fingerprints.json has no case "${name}".`);
    }
    return fixture;
  }

  /**
   * The file `fingerprint --json` writes for the contributors; its path.
   */
  function writeFingerprintFile(
    fileName: string,
    contributors: FingerprintContributors,
  ): string {
    const filePath = join(directoryPath, fileName);
    writeFileSync(
      filePath,
      JSON.stringify({
        fingerprint: computeFingerprint(contributors),
        ...contributors,
      }),
    );
    return filePath;
  }

  /**
   * The two fixtures' files, the earlier first, as the command's arguments.
   */
  function writeFixtureFiles(
    beforeFixture: FingerprintFixture,
    afterFixture: FingerprintFixture,
  ): string[] {
    return [
      writeFingerprintFile('before.json', beforeFixture.contributors),
      writeFingerprintFile('after.json', afterFixture.contributors),
    ];
  }

  function readTableRows(): string[][] {
    return harness.readLines().map(line => line.split(/ {2,}/));
  }

  it.each(MONOREPO_NAME_ENDINGS)(
    'should print the package removed and the one added between two workspaces %s',
    async nameEnding => {
      const scannerFixture = findFixture(
        `should hash the scanner workspace's native package alone ${nameEnding}`,
      );
      const checkoutFixture = findFixture(
        `should hash the checkout workspace's native package alone ${nameEnding}`,
      );

      await fingerprintDiffCommand.action(
        {},
        writeFixtureFiles(scannerFixture, checkoutFixture),
      );

      expect(readTableRows()).toEqual([
        ['PACKAGE', 'BEFORE', 'AFTER'],
        ['@example/capacitor-payments', 'none', '2.1.0'],
        ['@example/capacitor-scanner', '1.3.0', 'none'],
      ]);
    },
  );

  it('should print the changes as JSON', async () => {
    const scannerFixture = findFixture(
      "should hash the scanner workspace's native package alone in an npm monorepo",
    );
    const checkoutFixture = findFixture(
      "should hash the checkout workspace's native package alone in an npm monorepo",
    );
    const [scannerPackage] = scannerFixture.contributors.packages;
    const [paymentsPackage] = checkoutFixture.contributors.packages;

    await fingerprintDiffCommand.action(
      { json: true },
      writeFixtureFiles(scannerFixture, checkoutFixture),
    );

    expect(harness.readJson()).toEqual({
      nativeSources: [],
      packages: [
        {
          after: {
            integrity: paymentsPackage?.integrity,
            version: paymentsPackage?.version,
          },
          before: null,
          name: paymentsPackage?.name,
        },
        {
          after: null,
          before: {
            integrity: scannerPackage?.integrity,
            version: scannerPackage?.version,
          },
          name: scannerPackage?.name,
        },
      ],
    });
  });

  it('should print the integrities of the packages whose versions did not move', async () => {
    const yarnClassicFixture = findFixture(
      'should yield the same fingerprint from a yarn classic project with the same dependencies',
    );
    const yarnBerryFixture = findFixture(
      "should take each package's checksum as its integrity in a yarn berry project",
    );

    await fingerprintDiffCommand.action(
      {},
      writeFixtureFiles(yarnClassicFixture, yarnBerryFixture),
    );

    expect(readTableRows()).toEqual([
      ['PACKAGE', 'BEFORE', 'AFTER'],
      ...yarnClassicFixture.contributors.packages.map(
        ({ integrity, name }, index) => [
          name,
          integrity,
          yarnBerryFixture.contributors.packages[index]?.integrity,
        ],
      ),
    ]);
  });

  it('should print the versions of a package that moved', async () => {
    const { contributors } = findFixture(
      'should keep the native packages and the Capacitor runtime of an npm project',
    );

    await fingerprintDiffCommand.action({}, [
      writeFingerprintFile('before.json', contributors),
      writeFingerprintFile('after.json', {
        ...contributors,
        packages: contributors.packages.map(locked =>
          locked.name === '@capacitor/camera'
            ? {
                integrity: 'sha512-capacitorcamera800invented==',
                name: locked.name,
                version: '8.0.0',
              }
            : locked,
        ),
      }),
    ]);

    expect(readTableRows()).toEqual([
      ['PACKAGE', 'BEFORE', 'AFTER'],
      ['@capacitor/camera', '7.0.2', '8.0.0'],
    ]);
  });

  it('should print a version added beside the one both files install', async () => {
    await fingerprintDiffCommand.action(
      {},
      writeFixtureFiles(
        findFixture(
          'should keep the native packages and the Capacitor runtime of an npm project',
        ),
        findFixture(
          'should keep every version of a native package the lockfile installs',
        ),
      ),
    );

    expect(readTableRows()).toEqual([
      ['PACKAGE', 'BEFORE', 'AFTER'],
      ['@example/native-core', 'none', '1.4.0'],
    ]);
  });

  it('should print the native sources that moved when no package did', async () => {
    const nativeSourcesFixture = findFixture(
      'should hash the declared native sources, file by file, skipping hidden files',
    );

    await fingerprintDiffCommand.action(
      {},
      writeFixtureFiles(
        findFixture(
          'should keep the native packages and the Capacitor runtime of an npm project',
        ),
        nativeSourcesFixture,
      ),
    );

    expect(readTableRows()).toEqual([
      ['No package moved.'],
      ['NATIVE SOURCE', 'BEFORE', 'AFTER'],
      ...nativeSourcesFixture.contributors.nativeSources.map(
        ({ path, sha256 }) => [path, 'none', sha256],
      ),
    ]);
  });

  it('should say that nothing moved when both files hold one fingerprint', async () => {
    const npmFixture = findFixture(
      'should keep the native packages and the Capacitor runtime of an npm project',
    );

    await fingerprintDiffCommand.action(
      {},
      writeFixtureFiles(
        npmFixture,
        findFixture(
          'should yield the same fingerprint from a pnpm project with the same dependencies',
        ),
      ),
    );

    expect(harness.readLines()).toEqual([
      `Nothing moved: both files hold ${npmFixture.fingerprint}.`,
    ]);
  });

  it('should fail with E_INVALID_PARAMETER when a file is not a fingerprint', async () => {
    const beforeFilePath = writeFingerprintFile('before.json', {
      nativeSources: [],
      packages: [],
    });
    const afterFilePath = join(directoryPath, 'package.json');
    writeFileSync(afterFilePath, JSON.stringify({ name: 'demo' }));

    await expect(
      fingerprintDiffCommand.action({}, [beforeFilePath, afterFilePath]),
    ).rejects.toMatchObject({
      code: 'E_INVALID_PARAMETER',
      message: `<file-b>: ${afterFilePath} is not a fingerprint written by fingerprint --json`,
    });
  });

  it('should fail with E_INVALID_PARAMETER when a file cannot be read', async () => {
    const beforeFilePath = join(directoryPath, 'missing.json');

    await expect(
      fingerprintDiffCommand.action({}, [
        beforeFilePath,
        writeFingerprintFile('after.json', { nativeSources: [], packages: [] }),
      ]),
    ).rejects.toMatchObject({
      code: 'E_INVALID_PARAMETER',
      message: `<file-a>: cannot read ${beforeFilePath}`,
    });
  });

  it('should fail with E_INVALID_PARAMETER when more than two files are named', async () => {
    await expect(
      fingerprintDiffCommand.action({}, ['a.json', 'b.json', 'c.json']),
    ).rejects.toMatchObject({
      code: 'E_INVALID_PARAMETER',
      message:
        'c.json: fingerprint diff compares two files, <file-a> and <file-b>',
    });
  });

  it('should fail with E_MISSING_PARAMETER when a file is not named and nobody can be asked', async () => {
    await expect(
      fingerprintDiffCommand.action({}, [
        writeFingerprintFile('before.json', {
          nativeSources: [],
          packages: [],
        }),
      ]),
    ).rejects.toMatchObject({
      code: 'E_MISSING_PARAMETER',
      message: '<file-b> is missing',
    });
  });
});
