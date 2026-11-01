import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { InteractivityOptions } from './environment.js';
import { isInteractive } from './environment.js';
import { MissingParameterError, UnknownFrameworkError } from './errors.js';
import type { FrameworkModule } from './frameworks/index.js';
import { FRAMEWORK_MODULES } from './frameworks/index.js';
import { readPackageJson } from './package-json.js';
import { promptText } from './prompts.js';

export type Framework = 'capacitor' | 'cordova' | 'expo' | 'react_native';

interface InputDirectoryOptions extends InteractivityOptions {
  path?: string;
}

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
  const detectedModules = (
    Object.entries(FRAMEWORK_MODULES) as [Framework, FrameworkModule][]
  ).filter(([, { detectionPackageName }]) =>
    dependencyNames.has(detectionPackageName),
  );
  const detectedModule =
    detectedModules.find(([, { hasConfigFile }]) =>
      hasConfigFile(projectDirectoryPath),
    ) ?? detectedModules[0];
  if (detectedModule === undefined) {
    throw new UnknownFrameworkError();
  }
  return detectedModule[0];
}

export async function readInputDirectoryPath(
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
