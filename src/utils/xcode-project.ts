import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PBXFile, PBXNativeTarget, XcodeProject } from 'xcode';
import { project as parseXcodeProject } from 'xcode';
import type { InteractivityOptions } from './environment.js';
import { MissingParameterError, XcodeProjectError } from './errors.js';
import { promptSelect } from './prompts.js';

interface AppTarget {
  key: string;
  name: string;
}

interface XcodeTargetOptions extends InteractivityOptions {
  xcodeTarget?: string;
}

const APP_GROUP_NAME = 'App';

const APPLICATION_PRODUCT_TYPE = 'com.apple.product-type.application';

const JSON_FILE_TYPE = 'text.json';

const RESOURCE_FILE_NAME = 'hotcodepush.json';

const UTF8_FILE_ENCODING = 4;

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
 * Whether the project already copies the resource file into the app bundle.
 */
export function hasResourceReference(projectFilePath: string): boolean {
  return parseProject(projectFilePath).hasFile(RESOURCE_FILE_NAME) !== false;
}

/**
 * Adds `hotcodepush.json` to the app target's resources, in the `App` group the file is written into,
 * the way React Native's own scripts edit projects; the reference already there is left alone.
 */
export async function addResourceReference(
  projectFilePath: string,
  options: XcodeTargetOptions,
): Promise<'added' | 'present'> {
  const project = parseProject(projectFilePath);
  if (project.hasFile(RESOURCE_FILE_NAME) !== false) {
    return 'present';
  }
  const target = await resolveAppTarget(project, options);
  const groupKey =
    project.findPBXGroupKey({ path: APP_GROUP_NAME }) ??
    project.findPBXGroupKey({ name: APP_GROUP_NAME });
  if (groupKey === undefined) {
    throw new XcodeProjectError(
      `${projectFilePath} has no ${APP_GROUP_NAME} group to add ${RESOURCE_FILE_NAME} to`,
      undefined,
      projectFilePath,
    );
  }
  // the package's addResourceFile expects Cordova's Resources group, so the reference, the build file and the phase entry are added one by one
  const file = project.addFile(RESOURCE_FILE_NAME, groupKey, {
    defaultEncoding: UTF8_FILE_ENCODING,
    lastKnownFileType: JSON_FILE_TYPE,
    target: target.key,
  });
  if (file === null) {
    return 'present';
  }
  file.uuid = project.generateUuid();
  file.target = target.key;
  project.addToPbxBuildFileSection(file);
  project.addToPbxResourcesBuildPhase(file);
  deleteUndefinedFields(project, file);
  writeFileSync(projectFilePath, project.writeSync());
  return 'added';
}

/**
 * The package writes every field of a reference, an absent one as the word `undefined`; the entry keeps only what it has.
 */
function deleteUndefinedFields(project: XcodeProject, file: PBXFile): void {
  if (file.fileRef === undefined) {
    return;
  }
  const fileReference = project.pbxFileReferenceSection()[file.fileRef];
  if (typeof fileReference !== 'object') {
    return;
  }
  for (const [key, value] of Object.entries(fileReference)) {
    if (value === undefined) {
      delete fileReference[key];
    }
  }
}

async function resolveAppTarget(
  project: XcodeProject,
  options: XcodeTargetOptions,
): Promise<AppTarget> {
  const appTargets = resolveAppTargets(project);
  const [onlyTarget] = appTargets;
  if (onlyTarget !== undefined && appTargets.length === 1) {
    return onlyTarget;
  }
  if (options.xcodeTarget !== undefined) {
    const namedTarget = appTargets.find(
      ({ name }) => name === options.xcodeTarget,
    );
    if (namedTarget === undefined) {
      throw new MissingParameterError('--xcode-target');
    }
    return namedTarget;
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

function parseProject(projectFilePath: string): XcodeProject {
  try {
    // the package reads the file itself; reading it first turns a missing file into the CLI's error
    readFileSync(projectFilePath);
    return parseXcodeProject(projectFilePath).parseSync();
  } catch (error) {
    throw new XcodeProjectError(
      `${projectFilePath} could not be parsed`,
      error,
      projectFilePath,
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
