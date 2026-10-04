import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BINARY_CREATE_HOOK_COMMAND,
  BINARY_CREATE_HOOK_NAME,
} from '../config/consts.js';
import { HookOccupiedError } from './errors.js';

export interface PackageJson {
  cordova?: { plugins?: Record<string, unknown> };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  scripts?: Record<string, string>;
  version?: string;
}

/**
 * The state of the binary create hook in `package.json`: wired, free to take, occupied by a command to append to, or one the CLI cannot parse.
 */
export type BinaryCreateHookState =
  'absent' | 'occupied' | 'unparseable' | 'wired';

// A chain of commands appends with `&&`; a list, a pipe, a background job or several lines would change meaning
const UNPARSEABLE_SCRIPT_PATTERN = /[;|\n]|&\s*$/;

export function readPackageJson(projectDirectoryPath: string): PackageJson {
  return JSON.parse(
    readFileSync(join(projectDirectoryPath, 'package.json'), 'utf8'),
  ) as PackageJson;
}

export function resolveBinaryCreateHookState(
  packageJson: PackageJson,
): BinaryCreateHookState {
  const script = packageJson.scripts?.[BINARY_CREATE_HOOK_NAME];
  if (script === undefined || script.trim() === '') {
    return 'absent';
  }
  if (script.includes(BINARY_CREATE_HOOK_COMMAND)) {
    return 'wired';
  }
  return UNPARSEABLE_SCRIPT_PATTERN.test(script) ? 'unparseable' : 'occupied';
}

/**
 * Adds the binary create command to the hook script: as the script when there is none, appended with `&&` to an existing command;
 * a script already carrying it is left alone, and one the CLI cannot parse is the manual step.
 */
export function wireBinaryCreateHook(
  projectDirectoryPath: string,
): 'present' | 'wired' {
  const packageJsonPath = join(projectDirectoryPath, 'package.json');
  const packageJsonText = readFileSync(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonText) as PackageJson;
  const state = resolveBinaryCreateHookState(packageJson);
  if (state === 'wired') {
    return 'present';
  }
  if (state === 'unparseable') {
    throw new HookOccupiedError(BINARY_CREATE_HOOK_NAME);
  }
  const script = packageJson.scripts?.[BINARY_CREATE_HOOK_NAME];
  const scripts = {
    ...packageJson.scripts,
    [BINARY_CREATE_HOOK_NAME]:
      state === 'absent'
        ? BINARY_CREATE_HOOK_COMMAND
        : `${script?.trim()} && ${BINARY_CREATE_HOOK_COMMAND}`,
  };
  writeFileSync(
    packageJsonPath,
    stringifyLikeSource({ ...packageJson, scripts }, packageJsonText),
  );
  return 'wired';
}

/**
 * The JSON written back with the indentation and the final newline the file had, so the edit is the one line it means.
 */
export function stringifyLikeSource(
  value: unknown,
  sourceText: string,
): string {
  const indent = /^(\s+)"/m.exec(sourceText)?.[1] ?? '  ';
  const newline = sourceText.endsWith('\n') ? '\n' : '';
  return `${JSON.stringify(value, null, indent)}${newline}`;
}
