import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { isInteractive } from '../environment.js';
import { MissingParameterError } from '../errors.js';
import { promptText } from '../prompts.js';
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
      await promptText(
        '--android-path',
        'Where is the Android project?',
        options,
      ),
    ),
    ios: resolve(
      await promptText('--ios-path', 'Where is the iOS project?', options),
    ),
    missingError: undefined,
  };
}
