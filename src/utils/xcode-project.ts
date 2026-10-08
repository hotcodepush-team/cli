import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PBXNativeTarget, XcodeProject } from 'xcode';
import { project as parseXcodeProject } from 'xcode';
import type { InteractivityOptions } from './environment.js';
import {
  InvalidParameterError,
  MissingParameterError,
  XcodeProjectError,
} from './errors.js';
import { promptSelect } from './prompts.js';

interface AppTarget {
  key: string;
  name: string;
}

/**
 * The run-script phase that runs binary create in a framework's app target: the script, the phase it follows where
 * binary create reads that phase's output, none to follow the target's last phase, and the manual step that adds it by hand.
 */
export interface BinaryCreatePhase {
  anchorPhaseName: string | undefined;
  fix: string;
  shellScript: string;
}

interface XcodeTargetOptions extends InteractivityOptions {
  xcodeTarget?: string;
}

const APPLICATION_PRODUCT_TYPE = 'com.apple.product-type.application';

const BINARY_CREATE_PHASE_MARKER = 'binary-create-xcode.sh';

const BINARY_CREATE_PHASE_NAME = 'Create HotCodePush binary';

// the script reads the version and build from the built app's processed Info.plist: declared as the phase's input,
// Xcode processes the plist before it runs the phase
const INFO_PLIST_INPUT_PATH = '"$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)"';

/**
 * The `project.pbxproj` of the Capacitor iOS project: `App/App.xcodeproj` as `cap add ios` lays it out, else the first project found.
 */
export function resolveXcodeProjectFilePath(
  iosProjectPath: string,
): string | undefined {
  const capacitorProjectPath = join(iosProjectPath, 'App', 'App.xcodeproj');
  const projectPath = existsSync(capacitorProjectPath)
    ? capacitorProjectPath
    : findXcodeProjectPath(iosProjectPath);
  return projectPath === undefined
    ? undefined
    : join(projectPath, 'project.pbxproj');
}

/**
 * Whether the project already runs binary create: the phase is recognised by the script it runs, the same file name in every SDK.
 */
export function hasBinaryCreatePhase(projectFilePath: string): boolean {
  return readFileSync(projectFilePath, 'utf8').includes(
    BINARY_CREATE_PHASE_MARKER,
  );
}

/**
 * Adds the run-script phase that runs binary create to the app target, right after the phase whose output it reads, or
 * after the target's last phase; the phase already there is left alone, and a project without that phase is the manual step.
 */
export async function addBinaryCreatePhase(
  projectFilePath: string,
  phase: BinaryCreatePhase,
  options: XcodeTargetOptions,
): Promise<'added' | 'present'> {
  if (hasBinaryCreatePhase(projectFilePath)) {
    return 'present';
  }
  const project = parseProject(projectFilePath, phase.fix);
  const target = await resolveAppTarget(project, options);
  const nativeTarget = project.pbxNativeTargetSection()[target.key];
  const buildPhases =
    typeof nativeTarget === 'object' ? nativeTarget.buildPhases : [];
  const anchorPhaseIndex =
    phase.anchorPhaseName === undefined
      ? undefined
      : buildPhases.findIndex(
          ({ comment }) => comment === phase.anchorPhaseName,
        );
  if (anchorPhaseIndex === -1) {
    throw new XcodeProjectError(
      `${projectFilePath} has no "${phase.anchorPhaseName}" phase to run binary create after`,
      undefined,
      projectFilePath,
      phase.fix,
    );
  }
  const { buildPhase } = project.addBuildPhase(
    [],
    'PBXShellScriptBuildPhase',
    BINARY_CREATE_PHASE_NAME,
    target.key,
    {
      inputPaths: [INFO_PLIST_INPUT_PATH],
      shellPath: '/bin/sh',
      shellScript: phase.shellScript,
    },
  );
  // binary create writes hotcodepush.json, which carries the build's time, on every build; a phase without outputs
  // that is not marked so makes Xcode warn
  buildPhase.alwaysOutOfDate = 1;
  if (anchorPhaseIndex !== undefined) {
    // the package appends the phase to the target; binary create belongs right after the phase it reads
    const binaryCreatePhase = buildPhases.pop();
    if (binaryCreatePhase !== undefined) {
      buildPhases.splice(anchorPhaseIndex + 1, 0, binaryCreatePhase);
    }
  }
  writeFileSync(projectFilePath, project.writeSync());
  return 'added';
}

async function resolveAppTarget(
  project: XcodeProject,
  options: XcodeTargetOptions,
): Promise<AppTarget> {
  const appTargets = resolveAppTargets(project);
  if (options.xcodeTarget !== undefined) {
    const namedTarget = appTargets.find(
      ({ name }) => name === options.xcodeTarget,
    );
    if (namedTarget === undefined) {
      throw new InvalidParameterError(
        `--xcode-target: no app target is named ${options.xcodeTarget}; the targets are ${appTargets.map(({ name }) => name).join(', ')}`,
        undefined,
      );
    }
    return namedTarget;
  }
  const [onlyTarget] = appTargets;
  if (onlyTarget !== undefined && appTargets.length === 1) {
    return onlyTarget;
  }
  const targetKey = await promptSelect(
    '--xcode-target',
    'Which app target?',
    appTargets.map(({ key, name }) => ({ label: name, value: key })),
    options,
  );
  const selectedTarget = appTargets.find(({ key }) => key === targetKey);
  if (selectedTarget === undefined) {
    throw new MissingParameterError('--xcode-target');
  }
  return selectedTarget;
}

function findXcodeProjectPath(iosProjectPath: string): string | undefined {
  if (!existsSync(iosProjectPath)) {
    return undefined;
  }
  for (const directoryPath of [iosProjectPath, join(iosProjectPath, 'App')]) {
    const projectName = existsSync(directoryPath)
      ? readdirSync(directoryPath).find(name => name.endsWith('.xcodeproj'))
      : undefined;
    if (projectName !== undefined) {
      return join(directoryPath, projectName);
    }
  }
  return undefined;
}

function parseProject(projectFilePath: string, fix?: string): XcodeProject {
  try {
    // the package reads the file itself; reading it first turns a missing file into the CLI's error
    readFileSync(projectFilePath);
    return parseXcodeProject(projectFilePath).parseSync();
  } catch (error) {
    throw new XcodeProjectError(
      `${projectFilePath} could not be parsed`,
      error,
      projectFilePath,
      fix,
    );
  }
}

function resolveAppTargets(project: XcodeProject): AppTarget[] {
  return Object.entries(project.pbxNativeTargetSection())
    .filter(
      (entry): entry is [string, PBXNativeTarget] =>
        typeof entry[1] === 'object' &&
        entry[1].productType.replaceAll('"', '') === APPLICATION_PRODUCT_TYPE,
    )
    .map(([key, target]) => ({ key, name: target.name.replaceAll('"', '') }));
}
