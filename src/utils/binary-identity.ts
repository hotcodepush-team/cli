import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InvalidParameterError } from './errors.js';
import type { Platform } from './upload.js';

/**
 * The store build's version and build number: `CFBundleShortVersionString` and `CFBundleVersion` on iOS,
 * `versionName` and `versionCode` on Android, the unique identity an embedded bundle registers under.
 */
export interface BinaryIdentity {
  binaryBuild: string;
  binaryVersion: string;
}

/**
 * The identity read from the native project's own files, since Capacitor's copy hook runs outside Xcode and Gradle:
 * the Xcode project's `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`, or the Gradle file's `versionName` and `versionCode`.
 */
export function readBinaryIdentity(
  platform: Platform,
  nativeProjectPath: string,
): BinaryIdentity {
  return platform === 'ios'
    ? readIosIdentity(nativeProjectPath)
    : readAndroidIdentity(nativeProjectPath);
}

function readAndroidIdentity(androidProjectPath: string): BinaryIdentity {
  const gradleFilePath = ['build.gradle', 'build.gradle.kts']
    .map(fileName => join(androidProjectPath, 'app', fileName))
    .find(filePath => existsSync(filePath));
  if (gradleFilePath === undefined) {
    throw new InvalidParameterError(
      `--binary-version: no app/build.gradle under ${androidProjectPath} to read it from`,
      undefined,
    );
  }
  const gradleText = readFileSync(gradleFilePath, 'utf8');
  return {
    binaryBuild: readGradleValue(gradleText, 'versionCode', gradleFilePath),
    binaryVersion: readGradleValue(gradleText, 'versionName', gradleFilePath),
  };
}

function readIosIdentity(iosProjectPath: string): BinaryIdentity {
  const projectFilePath = findXcodeProjectFilePath(iosProjectPath);
  if (projectFilePath === undefined) {
    throw new InvalidParameterError(
      `--binary-version: no Xcode project under ${iosProjectPath} to read it from`,
      undefined,
    );
  }
  const projectText = readFileSync(projectFilePath, 'utf8');
  return {
    binaryBuild: readXcodeSetting(
      projectText,
      'CURRENT_PROJECT_VERSION',
      projectFilePath,
    ),
    binaryVersion: readXcodeSetting(
      projectText,
      'MARKETING_VERSION',
      projectFilePath,
    ),
  };
}

/**
 * The `project.pbxproj` of the first `.xcodeproj` under `App/`, Capacitor's layout, or directly under the iOS path.
 */
function findXcodeProjectFilePath(iosProjectPath: string): string | undefined {
  for (const directoryPath of [join(iosProjectPath, 'App'), iosProjectPath]) {
    if (!existsSync(directoryPath)) {
      continue;
    }
    const projectName = readdirSync(directoryPath).find(name =>
      name.endsWith('.xcodeproj'),
    );
    if (projectName !== undefined) {
      return join(directoryPath, projectName, 'project.pbxproj');
    }
  }
  return undefined;
}

function readGradleValue(
  gradleText: string,
  key: string,
  gradleFilePath: string,
): string {
  const value = new RegExp(`${key}\\s*=?\\s*"?([^"\\s]+)"?`).exec(
    gradleText,
  )?.[1];
  if (value === undefined) {
    throw new InvalidParameterError(
      `--binary-version: ${key} is missing from ${gradleFilePath}`,
      undefined,
    );
  }
  return value;
}

function readXcodeSetting(
  projectText: string,
  key: string,
  projectFilePath: string,
): string {
  const value = new RegExp(`${key} = "?([^";]+)"?;`).exec(projectText)?.[1];
  if (value === undefined) {
    throw new InvalidParameterError(
      `--binary-version: ${key} is missing from ${projectFilePath}`,
      undefined,
    );
  }
  return value;
}
