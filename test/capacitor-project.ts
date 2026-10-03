import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { computeFingerprint } from '@hotcodepush/protocol/fingerprint';

/**
 * What a Capacitor project's `package.json` starts with in a test: the framework, the SDK when installed, the hook when wired.
 */
export interface CapacitorProjectOptions {
  hookScript?: string;
  isPackageInstalled?: boolean;
  projectConfig?: object;
  webDir?: string;
}

/**
 * The fingerprint of a project whose lockfile installs `@capacitor/core` 8.0.0 beside a package without native code.
 */
export const CAPACITOR_FINGERPRINT = computeFingerprint({
  nativeSources: [],
  packages: [{ name: '@capacitor/core', version: '8.0.0' }],
});

export const PBXPROJ_FIXTURE_PATH = join(
  import.meta.dirname,
  'capacitor-project.pbxproj',
);

/**
 * A Capacitor project in a temporary directory: `package.json`, `capacitor.config.json`, the web build,
 * and the iOS project of `cap add ios` without the resource reference; the caller removes it.
 */
export function writeCapacitorProject({
  hookScript,
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
    scripts: {
      build: 'vite build',
      ...(hookScript === undefined
        ? {}
        : { 'capacitor:copy:after': hookScript }),
    },
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
  const pbxprojPath = join(
    directoryPath,
    'ios',
    'App',
    'App.xcodeproj',
    'project.pbxproj',
  );
  mkdirSync(dirname(pbxprojPath), { recursive: true });
  writeFileSync(pbxprojPath, readFileSync(PBXPROJ_FIXTURE_PATH));
  mkdirSync(join(directoryPath, 'android', 'app', 'src', 'main', 'assets'), {
    recursive: true,
  });
  return directoryPath;
}

/**
 * What the fingerprint reads: an npm lockfile and the packages it installs, `@capacitor/core` and a package without native code.
 */
export function writeFingerprintInputs(directoryPath: string): void {
  const packages = { '@capacitor/core': '8.0.0', 'left-pad': '1.3.0' };
  writeJson(join(directoryPath, 'package-lock.json'), {
    lockfileVersion: 3,
    name: 'demo',
    packages: {
      '': { dependencies: packages, name: 'demo' },
      ...Object.fromEntries(
        Object.entries(packages).map(([name, version]) => [
          `node_modules/${name}`,
          { version },
        ]),
      ),
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
