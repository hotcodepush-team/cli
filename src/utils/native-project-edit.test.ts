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
import { NativeProjectError } from './errors.js';
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

    it('should stop with the manual step, refused, when the Android project has no app Gradle file', () => {
      const edit = resolveGradleEdit(androidProjectPath, PACKAGE_NAME);
      expect(edit?.filePath).toBe(
        join(androidProjectPath, 'app', 'build.gradle'),
      );
      expect(edit?.isApplied()).toBe(false);
      expect(edit?.isRefused).toBe(true);

      expect(() => edit?.apply()).toThrow(
        new NativeProjectError(
          `The Android project ${androidProjectPath} has no build.gradle or build.gradle.kts in its app folder.`,
          `Apply node_modules/${PACKAGE_NAME}/android/hotcodepush.gradle from the app module's Gradle file.`,
        ),
      );
    });

    it('should answer no edit without an Android project', () => {
      rmSync(androidProjectPath, { recursive: true });

      expect(
        resolveGradleEdit(androidProjectPath, PACKAGE_NAME),
      ).toBeUndefined();
    });
  });
});
