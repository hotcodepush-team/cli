import { relative } from 'node:path';
import { INIT_MANUAL_STEP } from '../../config/consts.js';
import type { CliError } from '../errors.js';
import { NativeProjectError, XcodeProjectError } from '../errors.js';
import type { NativeProjectEdit } from '../native-project-edit.js';
import { resolveGradleEdit } from '../native-project-edit.js';
import type { BinaryCreatePhase } from '../xcode-project.js';
import {
  addBinaryCreatePhase,
  hasBinaryCreatePhase,
  resolveXcodeProjectFilePath,
} from '../xcode-project.js';
import type {
  FrameworkCheck,
  NativeProjectPaths,
  WiringOptions,
} from './index.js';

/**
 * The binary create phase a framework adds to the Xcode project it names.
 */
export interface BinaryCreatePhaseEdit {
  phase: BinaryCreatePhase;
  projectFilePath: string;
}

/**
 * `doctor`'s `hook` row where the native build runs the build step: the Xcode phase and the Gradle line `init` wires,
 * the line applying the Gradle file the SDK package ships.
 */
export function checkBinaryCreateStep(
  projectDirectoryPath: string,
  nativeProjectPaths: NativeProjectPaths,
  packageName: string,
): FrameworkCheck {
  const xcodeProjectFilePath = resolveXcodeProjectFilePath(
    nativeProjectPaths.ios,
  );
  const gradleEdit = resolveGradleEdit(nativeProjectPaths.android, packageName);
  if (xcodeProjectFilePath === undefined && gradleEdit === undefined) {
    return {
      check: 'hook',
      message: 'no native project to check',
      status: 'skipped',
    };
  }
  return checkEdits(
    'hook',
    'the Xcode phase and the Gradle task run the build step',
    gradleEdit === undefined ? [] : [gradleEdit],
    projectDirectoryPath,
    xcodeProjectFilePath !== undefined &&
      !hasBinaryCreatePhase(xcodeProjectFilePath),
  );
}

/**
 * A row over edits: ok when every one is in its file, failed naming the files that lack theirs, skipped without a native project.
 */
export function checkEdits(
  check: string,
  wiredMessage: string,
  edits: NativeProjectEdit[],
  projectDirectoryPath: string,
  isPhaseMissing = false,
): FrameworkCheck {
  const missingFilePaths = edits
    .filter(edit => !edit.isApplied())
    .map(({ filePath }) => relative(projectDirectoryPath, filePath));
  if (edits.length === 0 && !isPhaseMissing) {
    return { check, message: 'no native project to check', status: 'skipped' };
  }
  if (missingFilePaths.length > 0 || isPhaseMissing) {
    return {
      check,
      manualStep: INIT_MANUAL_STEP,
      message: `not wired in ${[...(isPhaseMissing ? ['the Xcode project'] : []), ...missingFilePaths].join(' and ')}`,
      status: 'failed',
    };
  }
  return { check, message: wiredMessage, status: 'ok' };
}

/**
 * The binary create phase where the Xcode project lacks it, then each edit: one a file has no place for does not hold
 * the others back, and once every one was tried the first one's manual step stops the step. Answers what was wired,
 * in the words `init` prints.
 */
export async function applyNativeProjectEdits(
  phaseEdit: BinaryCreatePhaseEdit | undefined,
  edits: NativeProjectEdit[],
  options: WiringOptions,
): Promise<string[]> {
  const errors: CliError[] = [];
  const wired: string[] = [];
  if (phaseEdit !== undefined) {
    try {
      if (
        (await addBinaryCreatePhase(
          phaseEdit.projectFilePath,
          phaseEdit.phase,
          options,
        )) === 'added'
      ) {
        wired.push('the Create HotCodePush binary phase in Xcode');
      }
    } catch (error) {
      errors.push(assertEditError(error));
    }
  }
  for (const edit of edits) {
    try {
      edit.apply();
      wired.push(edit.description);
    } catch (error) {
      errors.push(assertEditError(error));
    }
  }
  const [firstError] = errors;
  if (firstError !== undefined) {
    throw firstError;
  }
  return wired;
}

/**
 * An edit that found no place in its file is collected as the step's manual step; anything else is not the edit's to explain.
 */
function assertEditError(error: unknown): CliError {
  if (
    error instanceof NativeProjectError ||
    error instanceof XcodeProjectError
  ) {
    return error;
  }
  throw error;
}
