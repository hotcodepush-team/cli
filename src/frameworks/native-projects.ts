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
export async function resolveNativeProjects(
  projectDirectoryPath: string,
  defaultPaths: NativeProjectPaths,
  options: WiringOptions,
  missingProjectsStep: string,
): Promise<NativeProjects> {
  const android =
    options.androidPath === undefined
      ? defaultPaths.android
      : resolve(options.androidPath);
  const ios =
    options.iosPath === undefined ? defaultPaths.ios : resolve(options.iosPath);
  if (existsSync(android) || existsSync(ios)) {
    return { android, ios, missingError: undefined };
  }
  if (!isInteractive(options)) {
    return {
      android,
      ios,
      missingError: new MissingParameterError(
        '--ios-path',
        `Neither ${relative(projectDirectoryPath, ios)} nor ${relative(projectDirectoryPath, android)} exists. ${missingProjectsStep}`,
      ),
    };
  }
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
    missingError: undefined,
  };
}
