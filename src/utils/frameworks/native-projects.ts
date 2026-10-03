import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { isInteractive } from '../environment.js';
import { MissingParameterError } from '../errors.js';
import { promptText } from '../prompts.js';
import type { NativeProjectPaths, WiringOptions } from './index.js';

/**
 * The native projects the hook step wires and the reason it cannot when neither was found or named.
 */
export interface NativeProjects extends NativeProjectPaths {
  missingError: MissingParameterError | undefined;
}

/**
 * `--ios-path` and `--android-path`, typed against the working directory, over the framework's own paths;
 * neither found is asked for, and non-interactively the hook step's stop, whose fix starts with how the framework adds them.
 */
export async function resolveNativeProjects(
  projectDirectoryPath: string,
  defaultPaths: NativeProjectPaths,
  options: WiringOptions,
  addProjectsStep: string,
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
        `${addProjectsStep}pass --ios-path and --android-path; neither ${relative(projectDirectoryPath, ios)} nor ${relative(projectDirectoryPath, android)} exists.`,
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
