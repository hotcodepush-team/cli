import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InteractivityOptions } from './environment.js';
import {
  MissingParameterError,
  UnknownFrameworkError,
  UnsupportedFrameworkError,
} from './errors.js';
import type { ProjectConfig } from './project-config.js';
import { promptText } from './prompts.js';

export type Framework = 'capacitor' | 'cordova' | 'expo' | 'react-native';

interface InputDirectoryOptions extends InteractivityOptions {
  path?: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const FRAMEWORK_PACKAGES: [packageName: string, framework: Framework][] = [
  ['@capacitor/core', 'capacitor'],
  ['cordova', 'cordova'],
  ['expo', 'expo'],
  ['react-native', 'react-native'],
];

/**
 * The framework of the project, from `package.json`'s dependencies; Capacitor is the one the CLI packages today.
 */
export function detectFramework(projectDirectoryPath: string): Framework {
  const packageJsonPath = join(projectDirectoryPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new UnknownFrameworkError();
  }
  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, 'utf8'),
  ) as PackageJson;
  const dependencyNames = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
  const detected = FRAMEWORK_PACKAGES.find(([packageName]) =>
    dependencyNames.has(packageName),
  );
  if (detected === undefined) {
    throw new UnknownFrameworkError();
  }
  const [, framework] = detected;
  if (framework !== 'capacitor') {
    throw new UnsupportedFrameworkError(framework);
  }
  return framework;
}

/**
 * The web build to package: `--path`, otherwise `hotcodepush.json`'s `dir`, otherwise Capacitor's `webDir`,
 * otherwise asked for when interactive.
 */
export async function resolveInputDirectoryPath(
  options: InputDirectoryOptions,
  projectConfig: ProjectConfig | undefined,
  projectDirectoryPath: string,
): Promise<string> {
  const configuredPath =
    options.path ??
    projectConfig?.dir ??
    readCapacitorWebDir(projectDirectoryPath);
  if (configuredPath !== undefined) {
    return join(projectDirectoryPath, configuredPath);
  }
  return join(
    projectDirectoryPath,
    await promptText('--path', 'Where is the web build?', options),
  );
}

/**
 * `ios.path` and `android.path` of `capacitor.config`, or `ios/` and `android/` beside `package.json`.
 */
export function resolveNativeProjectPaths(projectDirectoryPath: string): {
  android: string;
  ios: string;
} {
  const capacitorConfig = readCapacitorConfig(projectDirectoryPath);
  return {
    android: join(
      projectDirectoryPath,
      readConfigValue(
        capacitorConfig,
        /android:\s*\{[^}]*?path:\s*['"]([^'"]+)['"]/,
      ) ?? 'android',
    ),
    ios: join(
      projectDirectoryPath,
      readConfigValue(
        capacitorConfig,
        /ios:\s*\{[^}]*?path:\s*['"]([^'"]+)['"]/,
      ) ?? 'ios',
    ),
  };
}

export function assertMissingParameter(
  value: string | undefined,
  flag: string,
): string {
  if (value === undefined) {
    throw new MissingParameterError(flag);
  }
  return value;
}

/**
 * The text of `capacitor.config.json` or `.ts`, read as text since the TypeScript form is code: the values are matched, never evaluated.
 */
function readCapacitorConfig(projectDirectoryPath: string): string | undefined {
  for (const fileName of ['capacitor.config.json', 'capacitor.config.ts']) {
    const filePath = join(projectDirectoryPath, fileName);
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf8');
    }
  }
  return undefined;
}

function readCapacitorWebDir(projectDirectoryPath: string): string | undefined {
  return readConfigValue(
    readCapacitorConfig(projectDirectoryPath),
    /webDir['"]?\s*:\s*['"]([^'"]+)['"]/,
  );
}

function readConfigValue(
  configText: string | undefined,
  pattern: RegExp,
): string | undefined {
  return configText === undefined ? undefined : pattern.exec(configText)?.[1];
}
