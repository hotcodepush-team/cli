import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PBXFile, PBXNativeTarget, XcodeProject } from 'xcode';
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

interface XcodeTargetOptions extends InteractivityOptions {
  xcodeTarget?: string;
}

const APP_GROUP_NAME = 'App';

const APPLICATION_PRODUCT_TYPE = 'com.apple.product-type.application';

const EMBED_PHASE_FIX =
  'add a Run Script phase after "Bundle React Native code and images" that runs node_modules/@hotcodepush/react-native-code-push/scripts/embed-xcode.sh through React Native\'s with-environment.sh.';

const EMBED_PHASE_MARKER = 'embed-xcode.sh';

const EMBED_PHASE_NAME = 'Create HotCodePush binary';

// the lines of the phase as a pbxproj string carries them, the line breaks escaped
const EMBED_PHASE_SCRIPT = [
  'set -e',
  '',
  '# hotcodepush: writes hotcodepush.json into the app and registers the binary',
  'WITH_ENVIRONMENT="$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh"',
  'HOTCODEPUSH_BINARY_CREATE="$REACT_NATIVE_PATH/../@hotcodepush/react-native-code-push/scripts/embed-xcode.sh"',
  '',
  '/bin/sh -c "$WITH_ENVIRONMENT $HOTCODEPUSH_BINARY_CREATE"',
  '',
].join('\\n');

const JSON_FILE_TYPE = 'text.json';

const REACT_NATIVE_BUNDLE_PHASE_NAME = 'Bundle React Native code and images';

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
 * Whether the React Native project already runs the embed step: the phase is recognised by the script it runs.
 */
export function hasEmbedPhase(projectFilePath: string): boolean {
  return readFileSync(projectFilePath, 'utf8').includes(EMBED_PHASE_MARKER);
}

/**
 * Adds the run-script phase that runs the embed step to the app target, right after "Bundle React Native code and images",
 * whose output it hashes; the phase already there is left alone, and a project without that bundling phase is the manual step.
 */
export async function addEmbedPhase(
  projectFilePath: string,
  options: XcodeTargetOptions,
): Promise<'added' | 'present'> {
  if (hasEmbedPhase(projectFilePath)) {
    return 'present';
  }
  const project = parseProject(projectFilePath, EMBED_PHASE_FIX);
  const target = await resolveAppTarget(project, options);
  const nativeTarget = project.pbxNativeTargetSection()[target.key];
  const buildPhases =
    typeof nativeTarget === 'object' ? nativeTarget.buildPhases : [];
  const bundlePhaseIndex = buildPhases.findIndex(
    ({ comment }) => comment === REACT_NATIVE_BUNDLE_PHASE_NAME,
  );
  if (bundlePhaseIndex === -1) {
    throw new XcodeProjectError(
      `${projectFilePath} has no "${REACT_NATIVE_BUNDLE_PHASE_NAME}" phase to run binary create after`,
      undefined,
      projectFilePath,
      EMBED_PHASE_FIX,
    );
  }
  project.addBuildPhase(
    [],
    'PBXShellScriptBuildPhase',
    EMBED_PHASE_NAME,
    target.key,
    { shellPath: '/bin/sh', shellScript: EMBED_PHASE_SCRIPT },
  );
  // the package appends the phase to the target; the embed step belongs right after the bundling it reads
  const embedPhase = buildPhases.pop();
  if (embedPhase !== undefined) {
    buildPhases.splice(bundlePhaseIndex + 1, 0, embedPhase);
  }
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
