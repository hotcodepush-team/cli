import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { InteractivityOptions } from './environment.js';
import { isInteractive } from './environment.js';
import { MissingParameterError, UnknownFrameworkError } from './errors.js';
import { CAPACITOR_CONFIG_FILE_NAMES } from './frameworks/capacitor.js';
import type { FrameworkModule } from './frameworks/index.js';
import { readJsonFile } from './json-file.js';
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
 * The framework of the project, from `package.json`'s dependencies, the framework's config file breaking a tie
 * when several are named, an Expo app's `react-native` among them.
 */
export function detectFramework(projectDirectoryPath: string): Framework {
  const packageJsonPath = join(projectDirectoryPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new UnknownFrameworkError();
  }
  const packageJson = readJsonFile(packageJsonPath) as PackageJson;
  const dependencyNames = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
  const detectedFrameworks = FRAMEWORK_PACKAGES.filter(([packageName]) =>
    dependencyNames.has(packageName),
  ).map(([, framework]) => framework);
  const framework =
    detectedFrameworks.find(detectedFramework =>
      hasFrameworkConfigFile(detectedFramework, projectDirectoryPath),
    ) ?? detectedFrameworks[0];
  if (framework === undefined) {
    throw new UnknownFrameworkError();
  }
  return framework;
}

/**
 * The build to package: the path the flag names as typed, against the working directory; otherwise the framework's own
 * build output, relative to the project root; otherwise asked for when interactive, the flag required with the reason
 * the framework names none when not.
 */
export async function resolveInputDirectoryPath(
  options: InputDirectoryOptions,
  pathFlag: string,
  projectDirectoryPath: string,
  framework: Pick<FrameworkModule, 'readBuildDirectory'>,
): Promise<string> {
  if (options.path !== undefined) {
    return resolve(options.path);
  }
  const buildDirectory = framework.readBuildDirectory(projectDirectoryPath);
  if ('path' in buildDirectory) {
    return join(projectDirectoryPath, buildDirectory.path);
  }
  if (!isInteractive(options)) {
    throw new MissingParameterError(
      pathFlag,
      `pass ${pathFlag}, since ${buildDirectory.missingReason}.`,
    );
  }
  return resolve(
    await promptText(pathFlag, 'Where is the web build?', options),
  );
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
 * The config file the framework keeps beside `package.json`: `capacitor.config`, `app.json` with its `expo` key,
 * Cordova's `config.xml`; React Native has none of its own.
 */
function hasFrameworkConfigFile(
  framework: Framework,
  projectDirectoryPath: string,
): boolean {
  switch (framework) {
    case 'capacitor':
      return CAPACITOR_CONFIG_FILE_NAMES.some(fileName =>
        existsSync(join(projectDirectoryPath, fileName)),
      );
    case 'cordova':
      return existsSync(join(projectDirectoryPath, 'config.xml'));
    case 'expo':
      return hasExpoAppJson(projectDirectoryPath);
    case 'react-native':
      return false;
  }
}

function hasExpoAppJson(projectDirectoryPath: string): boolean {
  const appJsonPath = join(projectDirectoryPath, 'app.json');
  if (!existsSync(appJsonPath)) {
    return false;
  }
  try {
    const appJson: unknown = JSON.parse(readFileSync(appJsonPath, 'utf8'));
    return typeof appJson === 'object' && appJson !== null && 'expo' in appJson;
  } catch {
    return false;
  }
}
