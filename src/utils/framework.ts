import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { InteractivityOptions } from './environment.js';
import { isInteractive } from './environment.js';
import { MissingParameterError, UnknownFrameworkError } from './errors.js';
import { CAPACITOR_CONFIG_FILE_NAMES } from './frameworks/capacitor.js';
import type { FrameworkModule } from './frameworks/index.js';
import { readPackageJson } from './package-json.js';
import { promptText } from './prompts.js';

export type Framework = 'capacitor' | 'cordova' | 'expo' | 'react_native';

interface InputDirectoryOptions extends InteractivityOptions {
  path?: string;
}

const FRAMEWORK_PACKAGES: [packageName: string, framework: Framework][] = [
  ['@capacitor/core', 'capacitor'],
  ['cordova', 'cordova'],
  ['expo', 'expo'],
  ['react-native', 'react_native'],
];

// An Expo app also depends on `react-native`, so the framework's config file breaks a tie.
export function detectFramework(projectDirectoryPath: string): Framework {
  if (!existsSync(join(projectDirectoryPath, 'package.json'))) {
    throw new UnknownFrameworkError();
  }
  const packageJson = readPackageJson(projectDirectoryPath);
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
      `Pass ${pathFlag}, since ${buildDirectory.missingReason}.`,
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
    case 'react_native':
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
