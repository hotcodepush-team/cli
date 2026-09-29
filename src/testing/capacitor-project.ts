import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * What a Capacitor project's `package.json` starts with in a test: the framework, the SDK when installed, the hook when wired.
 */
export interface CapacitorProjectOptions {
  hookScript?: string;
  isPackageInstalled?: boolean;
  projectConfig?: object;
  webDir?: string;
}

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

export function readJsonFile<TValue>(filePath: string): TValue {
  return JSON.parse(readFileSync(filePath, 'utf8')) as TValue;
}

function writeJson(filePath: string, value: object): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
