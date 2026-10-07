import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../test/command-harness.js';
import type {
  FingerprintFixture,
  RefusedFingerprintFixture,
} from '../../test/protocol-fixtures.js';
import { readFingerprintFixtures } from '../../test/protocol-fixtures.js';
import fingerprintCommand from './fingerprint.js';

const FINGERPRINT_FIXTURES = readFingerprintFixtures();

describe('fingerprint', () => {
  const harness = useCommandHarness();

  /**
   * The fixture's files with a hotcodepush.json declaring its native sources in the project's directory; the path of that file.
   */
  function writeFixtureProject(
    fixture: FingerprintFixture | RefusedFingerprintFixture,
  ): string {
    const rootConfigPath = harness.writeProjectConfig({
      nativeSources: fixture.nativeSourcePaths,
    });
    const rootDirectoryPath = dirname(rootConfigPath);
    for (const [path, content] of Object.entries(fixture.files)) {
      const filePath = join(rootDirectoryPath, path);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content);
    }
    const configPath = join(
      rootDirectoryPath,
      fixture.projectPath,
      'hotcodepush.json',
    );
    mkdirSync(dirname(configPath), { recursive: true });
    renameSync(rootConfigPath, configPath);
    return configPath;
  }

  it.each(FINGERPRINT_FIXTURES.cases.map(fixture => [fixture.name, fixture]))(
    'should print the fingerprint and its contributors as JSON: %s',
    async (_name, fixture) => {
      const configPath = writeFixtureProject(fixture);

      await fingerprintCommand.action(
        { config: configPath, json: true },
        undefined,
      );

      expect(harness.readJson()).toEqual({
        fingerprint: fixture.fingerprint,
        ...fixture.contributors,
      });
    },
  );

  it('should print the fingerprint, the packages with their versions and the native sources', async () => {
    const fixture = FINGERPRINT_FIXTURES.cases.find(
      ({ contributors }) =>
        contributors.nativeSources.length > 0 &&
        contributors.packages.length > 0,
    );
    if (fixture === undefined) {
      throw new Error('fingerprints.json has no case with native sources.');
    }
    const configPath = writeFixtureProject(fixture);

    await fingerprintCommand.action({ config: configPath }, undefined);

    const lines = harness.readLines();
    expect(lines[0]).toBe(`Fingerprint ${fixture.fingerprint}`);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^PACKAGE +VERSION$/),
        ...fixture.contributors.packages.map(({ name, version }) =>
          expect.stringMatching(new RegExp(`^${name} +${version}$`)),
        ),
        expect.stringMatching(/^NATIVE SOURCE +SHA-256$/),
        ...fixture.contributors.nativeSources.map(({ path, sha256 }) =>
          expect.stringMatching(new RegExp(`^${path} +${sha256}$`)),
        ),
      ]),
    );
  });

  it('should say so when no installed package ships native code', async () => {
    const fixture = FINGERPRINT_FIXTURES.cases.find(
      ({ contributors }) =>
        contributors.nativeSources.length === 0 &&
        contributors.packages.length === 0,
    );
    if (fixture === undefined) {
      throw new Error('fingerprints.json has no case of an empty contract.');
    }
    const configPath = writeFixtureProject(fixture);

    await fingerprintCommand.action({ config: configPath }, undefined);

    expect(harness.readLines()).toEqual([
      `Fingerprint ${fixture.fingerprint}`,
      'No installed package ships native code.',
    ]);
  });

  it.each(
    FINGERPRINT_FIXTURES.refusedProjects.map(fixture => [
      fixture.name,
      fixture,
    ]),
  )(
    'should fail with E_FINGERPRINT_UNAVAILABLE when the recipe refuses the project: %s',
    async (_name, fixture) => {
      const configPath = writeFixtureProject(fixture);

      await expect(
        fingerprintCommand.action({ config: configPath }, undefined),
      ).rejects.toMatchObject({ code: 'E_FINGERPRINT_UNAVAILABLE' });
    },
  );
});
