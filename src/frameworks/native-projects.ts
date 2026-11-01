import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { isInteractive } from '../utils/environment.js';
import { MissingParameterError } from '../utils/errors.js';
import { promptText } from '../utils/prompts.js';
import type { NativeProjectPaths, WiringOptions } from './index.js';

export interface NativeProjects extends NativeProjectPaths {
  missingError: MissingParameterError | undefined;
}

// Non-interactively, missing projects stop the hook step later instead of failing here.
export async function locateNativeProjects(
  options: WiringOptions,
  {
    defaultPaths,
    missingProjectsStep,
    projectDirectoryPath,
  }: {
    defaultPaths: NativeProjectPaths;
    missingProjectsStep: string;
    projectDirectoryPath: string;
  },
): Promise<NativeProjects> {
  const paths = resolveGivenPaths(options, defaultPaths);
  if (existsSync(paths.android) || existsSync(paths.ios)) {
    return { ...paths, missingError: undefined };
  }
  if (!isInteractive(options)) {
    return {
      ...paths,
      missingError: buildMissingProjectsError(paths, {
        missingProjectsStep,
        projectDirectoryPath,
      }),
    };
  }
  return {
    ...(await promptNativeProjectPaths(options)),
    missingError: undefined,
  };
}

function buildMissingProjectsError(
  { android, ios }: NativeProjectPaths,
  {
    missingProjectsStep,
    projectDirectoryPath,
  }: { missingProjectsStep: string; projectDirectoryPath: string },
): MissingParameterError {
  return new MissingParameterError(
    '--ios-path',
    `Neither ${relative(projectDirectoryPath, ios)} nor ${relative(projectDirectoryPath, android)} exists. ${missingProjectsStep}`,
  );
}

async function promptNativeProjectPaths(
  options: WiringOptions,
): Promise<NativeProjectPaths> {
  return {
    android: resolve(
      await promptText(options, {
        flag: '--android-path',
        message: 'Where is the Android project?',
      }),
    ),
    ios: resolve(
      await promptText(options, {
        flag: '--ios-path',
        message: 'Where is the iOS project?',
      }),
    ),
  };
}

function resolveGivenPaths(
  options: WiringOptions,
  defaultPaths: NativeProjectPaths,
): NativeProjectPaths {
  return {
    android:
      options.androidPath === undefined
        ? defaultPaths.android
        : resolve(options.androidPath),
    ios:
      options.iosPath === undefined
        ? defaultPaths.ios
        : resolve(options.iosPath),
  };
}
