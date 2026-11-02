import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { InteractivityOptions } from '../utils/environment.js';
import { isInteractive } from '../utils/environment.js';
import {
  MissingParameterError,
  UnknownFrameworkError,
} from '../utils/errors.js';
import { readPackageJson } from '../utils/package-json.js';
import { promptText } from '../utils/prompts.js';
import type { FrameworkModule } from './index.js';
import { FRAMEWORK_MODULES } from './index.js';

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
  {
    framework,
    pathFlag,
    projectDirectoryPath,
  }: {
    framework: Pick<FrameworkModule, 'readBuildDirectory'>;
    pathFlag: string;
    projectDirectoryPath: string;
  },
): Promise<string> {
  if (options.path !== undefined) {
    return resolve(options.path);
  }
  const buildDirectory = framework.readBuildDirectory(projectDirectoryPath);
  if ('path' in buildDirectory) {
    return join(projectDirectoryPath, buildDirectory.path);
  }
  if (!isInteractive(options)) {
    throw new MissingParameterError(pathFlag, {
      fix: `Pass ${pathFlag}, since ${buildDirectory.missingReason}.`,
    });
  }
  return resolve(
    await promptText(options, {
      flag: pathFlag,
      message: 'Where is the web build?',
    }),
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
