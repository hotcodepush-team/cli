import { relative } from 'node:path';
import { INIT_MANUAL_STEP } from '../config/consts.js';
import type { CliError } from '../utils/errors.js';
import { NativeProjectError, XcodeProjectError } from '../utils/errors.js';
import type { NativeProjectEdit } from './native-project-edit.js';
import { resolveGradleEdit } from './native-project-edit.js';
import type { NativeProjects } from './native-projects.js';
import type { BinaryCreatePhase } from './xcode-project.js';
import {
  addBinaryCreatePhase,
  hasBinaryCreatePhase,
  resolveXcodeProjectFilePath,
} from './xcode-project.js';
import type {
  FrameworkCheck,
  NativeProjectPaths,
  StepOutcome,
  WiringOptions,
} from './index.js';

export interface BinaryCreatePhaseEdit {
  phase: BinaryCreatePhase;
  projectFilePath: string;
}

// The native projects init edits, located once for the plan and the step.
export interface LocatedNativeProjects {
  nativeProjects: NativeProjects;
  xcodeProjectFilePath: string | undefined;
}

export function checkBinaryCreateStep(
  projectDirectoryPath: string,
  {
    nativeProjectPaths,
    packageName,
  }: { nativeProjectPaths: NativeProjectPaths; packageName: string },
): FrameworkCheck {
  const xcodeProjectFilePath = resolveXcodeProjectFilePath(
    nativeProjectPaths.ios,
  );
  const gradleEdit = resolveGradleEdit(nativeProjectPaths.android, packageName);
  return checkEdits(gradleEdit === undefined ? [] : [gradleEdit], {
    check: 'hook',
    isPhaseMissing: isBinaryCreatePhaseMissing(xcodeProjectFilePath),
    projectDirectoryPath,
    wiredMessage: 'The Xcode phase and the Gradle task run the build step.',
  });
}

export function checkEdits(
  edits: NativeProjectEdit[],
  {
    check,
    isPhaseMissing = false,
    projectDirectoryPath,
    wiredMessage,
  }: {
    check: string;
    isPhaseMissing?: boolean;
    projectDirectoryPath: string;
    wiredMessage: string;
  },
): FrameworkCheck {
  const missingFilePaths = edits
    .filter(edit => !edit.isApplied())
    .map(({ filePath }) => relative(projectDirectoryPath, filePath));
  if (edits.length === 0 && !isPhaseMissing) {
    return {
      check,
      message: 'There is no native project to check.',
      status: 'skipped',
    };
  }
  if (missingFilePaths.length > 0 || isPhaseMissing) {
    return {
      check,
      code: 'wiring_missing',
      manualStep: INIT_MANUAL_STEP,
      message: `The wiring is missing from ${[...(isPhaseMissing ? ['the Xcode project'] : []), ...missingFilePaths].join(' and ')}.`,
      status: 'failed',
    };
  }
  return { check, message: wiredMessage, status: 'ok' };
}

// A failed edit does not hold the others back. Once all were tried, the first failure stops the step.
export async function applyNativeProjectEdits(
  edits: NativeProjectEdit[],
  {
    options,
    phaseEdit,
  }: { options: WiringOptions; phaseEdit: BinaryCreatePhaseEdit | undefined },
): Promise<string[]> {
  const errors: CliError[] = [];
  const wired: string[] = [];
  if (phaseEdit !== undefined) {
    try {
      if (
        (await addBinaryCreatePhase(phaseEdit.projectFilePath, {
          options,
          phase: phaseEdit.phase,
        })) === 'added'
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

export function isBinaryCreatePhaseMissing(
  xcodeProjectFilePath: string | undefined,
): xcodeProjectFilePath is string {
  return (
    xcodeProjectFilePath !== undefined &&
    !hasBinaryCreatePhase(xcodeProjectFilePath)
  );
}

export function resolveWiredOutcome(wired: string[]): StepOutcome<undefined> {
  return {
    message: `Wired ${wired.join(', ')}.`,
    status: 'done',
    value: undefined,
  };
}

// Only an edit that found no place in its file becomes the manual step. Any other error is rethrown.
function assertEditError(error: unknown): CliError {
  if (
    error instanceof NativeProjectError ||
    error instanceof XcodeProjectError
  ) {
    return error;
  }
  throw error;
}
