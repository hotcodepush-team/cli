import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LockedPackage } from '@hotcodepush/protocol/fingerprint';
import { computeFingerprint } from '@hotcodepush/protocol/fingerprint';
import { capacitorFramework } from '../src/utils/frameworks/capacitor.js';

/**
 * What a Capacitor project starts with in a test: the framework, the SDK when installed, its configuration and web build.
 */
export interface CapacitorProjectOptions {
  isPackageInstalled?: boolean;
  projectConfig?: object;
  webDir?: string;
}

const CAPACITOR_CORE_INTEGRITY = 'sha512-capacitorcore800invented==';

/**
 * The packages of the fingerprint inputs that contribute: `@capacitor/core` 8.0.0, never the package without native code.
 */
export const CAPACITOR_LOCKED_PACKAGES: LockedPackage[] = [
  {
    integrity: CAPACITOR_CORE_INTEGRITY,
    name: '@capacitor/core',
    version: '8.0.0',
  },
];

/**
 * The fingerprint of the fingerprint inputs without custom native sources.
 */
export const CAPACITOR_FINGERPRINT = computeFingerprint({
  nativeSources: [],
  packages: CAPACITOR_LOCKED_PACKAGES,
});

export const CAPACITOR_APP_GRADLE_FILE_PATH = join(
  'android',
  'app',
  'build.gradle',
);

export const CAPACITOR_XCODE_PROJECT_FILE_PATH = join(
  'ios',
  'App',
  'App.xcodeproj',
  'project.pbxproj',
);

export const PBXPROJ_FIXTURE_PATH = join(
  import.meta.dirname,
  'capacitor-project.pbxproj',
);

/**
 * A Capacitor project in a temporary directory: `package.json`, `capacitor.config.json`, the web build,
 * the iOS project of `cap add ios` and the app's Gradle file of `cap add android`, neither wired; the caller removes it.
 */
export function writeCapacitorProject({
  isPackageInstalled = false,
  projectConfig,
  webDir = 'www',
}: CapacitorProjectOptions = {}): string {
  const directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-project-'));
  writeJson(join(directoryPath, 'package.json'), {
    dependencies: {
      '@capacitor/core': '8.0.0',
      ...(isPackageInstalled
        ? { '@hotcodepush/capacitor-live-updates': '0.1.0' }
        : {}),
    },
    name: 'demo',
    scripts: { build: 'vite build' },
    version: '1.0.0',
  });
  writeJson(join(directoryPath, 'capacitor.config.json'), {
    appId: 'com.example.demo',
    webDir,
  });
  if (projectConfig !== undefined) {
    writeJson(join(directoryPath, 'hotcodepush.json'), projectConfig);
  }
  mkdirSync(join(directoryPath, webDir));
  writeFileSync(join(directoryPath, webDir, 'index.html'), '<h1>v1</h1>');
  const pbxprojPath = join(directoryPath, CAPACITOR_XCODE_PROJECT_FILE_PATH);
  mkdirSync(dirname(pbxprojPath), { recursive: true });
  writeFileSync(pbxprojPath, readFileSync(PBXPROJ_FIXTURE_PATH));
  mkdirSync(join(directoryPath, 'android', 'app'), { recursive: true });
  writeFileSync(
    join(directoryPath, CAPACITOR_APP_GRADLE_FILE_PATH),
    "apply plugin: 'com.android.application'\n",
  );
  return directoryPath;
}

/**
 * The project with the Xcode phase and the Gradle line `init` wires, made the way `init` makes them.
 */
export async function wireCapacitorProject(
  directoryPath: string,
): Promise<void> {
  const wiring = await capacitorFramework.resolveWiring(
    { directoryPath, packageJson: undefined },
    { yes: true },
  );
  await wiring.wireBinaryCreateStep(undefined);
}

/**
 * What the fingerprint reads: an npm lockfile and the packages it installs, `@capacitor/core` and a package without native code,
 * both added to the dependencies of the project's `package.json`, which the recipe walks from.
 */
export function writeFingerprintInputs(directoryPath: string): void {
  const packages = { '@capacitor/core': '8.0.0', 'left-pad': '1.3.0' };
  const packageJsonPath = join(directoryPath, 'package.json');
  const packageJson = existsSync(packageJsonPath)
    ? readJsonFile<{ dependencies?: Record<string, string> }>(packageJsonPath)
    : {};
  writeJson(packageJsonPath, {
    ...packageJson,
    dependencies: { ...packageJson.dependencies, ...packages },
  });
  writeJson(join(directoryPath, 'package-lock.json'), {
    lockfileVersion: 3,
    name: 'demo',
    packages: {
      '': { dependencies: packages, name: 'demo' },
      'node_modules/@capacitor/core': {
        integrity: CAPACITOR_CORE_INTEGRITY,
        version: '8.0.0',
      },
      'node_modules/left-pad': {
        integrity: 'sha512-leftpad130invented==',
        version: '1.3.0',
      },
    },
  });
  for (const [name, version] of Object.entries(packages)) {
    const packagePath = join(directoryPath, 'node_modules', name);
    mkdirSync(packagePath, { recursive: true });
    writeJson(join(packagePath, 'package.json'), { name, version });
  }
}

export function readJsonFile<TValue>(filePath: string): TValue {
  return JSON.parse(readFileSync(filePath, 'utf8')) as TValue;
}

function writeJson(filePath: string, value: object): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
