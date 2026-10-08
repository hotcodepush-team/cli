import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveGradleEdit } from './native-project-edit.js';

const PACKAGE_NAME = '@hotcodepush/capacitor-live-updates';

describe('native-project-edit', () => {
  let androidProjectPath = '';

  beforeEach(() => {
    androidProjectPath = mkdtempSync(join(tmpdir(), 'hotcodepush-android-'));
    mkdirSync(join(androidProjectPath, 'app'));
  });

  afterEach(() => {
    rmSync(androidProjectPath, { force: true, recursive: true });
  });

  function readLastLine(fileName: string): string | undefined {
    return readFileSync(join(androidProjectPath, 'app', fileName), 'utf8')
      .split('\n')
      .at(-2);
  }

  describe('resolveGradleEdit', () => {
    it("should append the one apply from line that resolves the SDK package's Gradle file through Node", () => {
      writeFileSync(
        join(androidProjectPath, 'app', 'build.gradle'),
        "apply plugin: 'com.android.application'\n",
      );
      const edit = resolveGradleEdit(androidProjectPath, PACKAGE_NAME);
      expect(edit?.isApplied()).toBe(false);

      edit?.apply();

      expect(edit?.isApplied()).toBe(true);
      expect(readLastLine('build.gradle')).toBe(
        `apply from: new File(["node", "--print", "require.resolve('${PACKAGE_NAME}/package.json')"].execute(null, rootDir).text.trim(), "../android/hotcodepush.gradle")`,
      );
    });

    it('should write the line in Kotlin syntax when the file is build.gradle.kts', () => {
      writeFileSync(
        join(androidProjectPath, 'app', 'build.gradle.kts'),
        'plugins { id("com.android.application") }',
      );

      resolveGradleEdit(androidProjectPath, PACKAGE_NAME)?.apply();

      expect(readLastLine('build.gradle.kts')).toBe(
        `apply(from = File(providers.exec { workingDir(rootDir); commandLine("node", "--print", "require.resolve('${PACKAGE_NAME}/package.json')") }.standardOutput.asText.get().trim()).resolveSibling("android/hotcodepush.gradle"))`,
      );
    });

    it('should answer no edit when the Android project has no app Gradle file', () => {
      expect(
        resolveGradleEdit(androidProjectPath, PACKAGE_NAME),
      ).toBeUndefined();
    });
  });
});
