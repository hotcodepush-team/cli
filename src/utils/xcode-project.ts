import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type {
  PBXNativeTarget,
  PbxprojHash,
  PbxprojSection,
  XcodeProject,
} from 'xcode';
import { project as createXcodeProject } from 'xcode';
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

// Without an anchor phase, the phase follows the target's last phase.
export interface BinaryCreatePhase {
  anchorPhaseName: string | undefined;
  fix: string;
  shellScript: string;
}

interface EditableProject {
  keptNumbers: string[];
  project: XcodeProject;
}

interface XcodeTargetOptions extends InteractivityOptions {
  xcodeTarget?: string;
}

const APPLICATION_PRODUCT_TYPE = 'com.apple.product-type.application';

const BINARY_CREATE_PHASE_MARKER = 'binary-create-xcode.sh';

const BINARY_CREATE_PHASE_NAME = 'Create HotCodePush binary';

const KEPT_NUMBER_PLACEHOLDER_PATTERN = /hotcodepushKeptNumber(\d+)_/g;

// Matches a value of digits alone, after `=`, `(` or `,` and before `;`, `,` or a line break.
const NUMBER_VALUE_PATTERN = /(?<=[=(,]\s*)\d+(?=[;,\n])/g;

// The `xcode` package's project parses only a file, so its grammar module parses the text.
const pbxprojParser = createRequire(import.meta.url)(
  'xcode/lib/parser/pbxproj.js',
) as { parse: (text: string) => PbxprojHash };

// The script reads the version and build from the processed Info.plist.
// As the phase's input, Xcode processes the plist before the phase runs.
const INFO_PLIST_INPUT_PATH = '"$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)"';

const RESOURCE_FILE_NAME = 'hotcodepush.json';

// `cap add ios` lays out `App/App.xcodeproj`. Any other layout takes the first project found.
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

// Every SDK names its script file the same, so the file name recognises the phase.
export function hasBinaryCreatePhase(projectFilePath: string): boolean {
  return readFileSync(projectFilePath, 'utf8').includes(
    BINARY_CREATE_PHASE_MARKER,
  );
}

// A pbxproj string carries its line breaks escaped.
export function buildPbxprojShellScript(lines: string[]): string {
  return lines.join('\\n');
}

export async function addBinaryCreatePhase(
  projectFilePath: string,
  phase: BinaryCreatePhase,
  options: XcodeTargetOptions,
): Promise<'added' | 'present'> {
  if (hasBinaryCreatePhase(projectFilePath)) {
    return 'present';
  }
  const editableProject = parseProject(projectFilePath, phase.fix);
  const { project } = editableProject;
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
      `The Xcode project ${projectFilePath} has no "${phase.anchorPhaseName}" phase to run the build step after.`,
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
  // The phase writes hotcodepush.json with the build time on every build.
  // Xcode warns about a phase without outputs that is not marked so.
  buildPhase.alwaysOutOfDate = 1;
  if (anchorPhaseIndex !== undefined) {
    // The package appends the phase, but it must run right after the phase whose output it reads.
    const binaryCreatePhase = buildPhases.pop();
    if (binaryCreatePhase !== undefined) {
      buildPhases.splice(anchorPhaseIndex + 1, 0, binaryCreatePhase);
    }
  }
  writeProject(projectFilePath, editableProject);
  return 'added';
}

// An earlier `init` added this reference to Capacitor's app target.
// A project that cannot be parsed counts as without it, and the phase's edit reports the parse error.
export function hasReadableResourceReference(projectFilePath: string): boolean {
  try {
    return (
      findResourceReferenceKeys(parseProject(projectFilePath).project).length >
      0
    );
  } catch {
    return false;
  }
}

// The build step now writes the file into the app, and a reference to a missing file fails the build.
export function removeResourceReference(projectFilePath: string): void {
  const editableProject = parseProject(projectFilePath);
  const { project } = editableProject;
  const { objects } = project.hash.project;
  const fileReferenceKeys = findResourceReferenceKeys(project);
  const buildFileKeys = Object.entries(objects.PBXBuildFile)
    .filter(
      ([, buildFile]) =>
        typeof buildFile === 'object' &&
        fileReferenceKeys.includes(String(buildFile.fileRef)),
    )
    .map(([key]) => key);
  deleteObjects(objects.PBXFileReference, fileReferenceKeys);
  deleteObjects(objects.PBXBuildFile, buildFileKeys);
  removeChildren(objects.PBXResourcesBuildPhase ?? {}, 'files', buildFileKeys);
  removeChildren(objects.PBXGroup, 'children', fileReferenceKeys);
  writeProject(projectFilePath, editableProject);
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
        `No app target is named ${options.xcodeTarget}. The targets are ${appTargets.map(({ name }) => name).join(', ')}.`,
        'Pass one of them with --xcode-target.',
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

function deleteObjects(section: PbxprojSection, keys: string[]): void {
  for (const key of keys) {
    delete section[key];
    delete section[`${key}_comment`];
  }
}

function findResourceReferenceKeys(project: XcodeProject): string[] {
  return Object.entries(project.pbxFileReferenceSection())
    .filter(
      ([, fileReference]) =>
        typeof fileReference === 'object' &&
        String(fileReference.path).replaceAll('"', '') === RESOURCE_FILE_NAME,
    )
    .map(([key]) => key);
}

function removeChildren(
  section: PbxprojSection,
  field: 'children' | 'files',
  keys: string[],
): void {
  for (const sectionObject of Object.values(section)) {
    const entries =
      typeof sectionObject === 'object' ? sectionObject[field] : undefined;
    if (typeof sectionObject === 'object' && Array.isArray(entries)) {
      sectionObject[field] = (entries as { value: string }[]).filter(
        ({ value }) => !keys.includes(value),
      );
    }
  }
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

// The `xcode` package reads digits as a JavaScript number, so `0920` would come back as `920` and long values lose digits.
// Such values pass through as text placeholders, and `writeProject` puts them back.
function parseProject(projectFilePath: string, fix?: string): EditableProject {
  try {
    const keptNumbers: string[] = [];
    const text = readFileSync(projectFilePath, 'utf8').replace(
      NUMBER_VALUE_PATTERN,
      number => {
        if (String(Number.parseInt(number, 10)) === number) {
          return number;
        }
        keptNumbers.push(number);
        return `hotcodepushKeptNumber${keptNumbers.length - 1}_`;
      },
    );
    const project = createXcodeProject(projectFilePath);
    project.hash = pbxprojParser.parse(text);
    return { keptNumbers, project };
  } catch (error) {
    throw new XcodeProjectError(
      `The Xcode project ${projectFilePath} could not be parsed.`,
      error,
      projectFilePath,
      fix,
    );
  }
}

function writeProject(
  projectFilePath: string,
  { keptNumbers, project }: EditableProject,
): void {
  writeFileSync(
    projectFilePath,
    project
      .writeSync()
      .replace(
        KEPT_NUMBER_PLACEHOLDER_PATTERN,
        (placeholder, index: string) =>
          keptNumbers[Number(index)] ?? placeholder,
      ),
  );
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
