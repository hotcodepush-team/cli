import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBinaryIdentity } from './binary-identity.js';
import { InvalidParameterError } from './errors.js';

describe('binary identity', () => {
  let directoryPath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-identity-'));
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  it("should read the Xcode project's marketing version and build number", () => {
    mkdirSync(join(directoryPath, 'App', 'App.xcodeproj'), { recursive: true });
    writeFileSync(
      join(directoryPath, 'App', 'App.xcodeproj', 'project.pbxproj'),
      '\t\t\t\tCURRENT_PROJECT_VERSION = 57;\n\t\t\t\tMARKETING_VERSION = 2.4.1;\n',
    );

    expect(readBinaryIdentity('ios', directoryPath)).toEqual({
      binaryBuild: '57',
      binaryVersion: '2.4.1',
    });
  });

  it("should read the Gradle file's version name and code, in the Groovy and the Kotlin syntax", () => {
    mkdirSync(join(directoryPath, 'app'), { recursive: true });
    writeFileSync(
      join(directoryPath, 'app', 'build.gradle'),
      'android {\n    defaultConfig {\n        versionCode 57\n        versionName "2.4.1"\n    }\n}\n',
    );
    expect(readBinaryIdentity('android', directoryPath)).toEqual({
      binaryBuild: '57',
      binaryVersion: '2.4.1',
    });

    rmSync(join(directoryPath, 'app', 'build.gradle'));
    writeFileSync(
      join(directoryPath, 'app', 'build.gradle.kts'),
      'defaultConfig {\n    versionCode = 58\n    versionName = "2.4.2"\n}\n',
    );
    expect(readBinaryIdentity('android', directoryPath)).toEqual({
      binaryBuild: '58',
      binaryVersion: '2.4.2',
    });
  });

  it('should name the flag to pass when the native project is missing', () => {
    expect(() => readBinaryIdentity('ios', directoryPath)).toThrow(
      InvalidParameterError,
    );
    expect(() => readBinaryIdentity('android', directoryPath)).toThrow(
      InvalidParameterError,
    );
  });
});
