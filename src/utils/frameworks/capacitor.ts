import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  CAPACITOR_PACKAGE_NAME,
  CAPACITOR_PACKAGE_SPEC,
} from '../../config/consts.js';
import type { ConfirmationRequiredError } from '../errors.js';
import type { StepOutcome } from '../init-steps.js';
import type { NativeProjectEdit } from '../native-project-edit.js';
import { resolveGradleEdit } from '../native-project-edit.js';
import type { BinaryCreatePhase } from '../xcode-project.js';
import {
  hasBinaryCreatePhase,
  hasReadableResourceReference,
  removeResourceReference,
  resolveXcodeProjectFilePath,
} from '../xcode-project.js';
import {
  applyNativeProjectEdits,
  checkBinaryCreateStep,
} from './binary-create-step.js';
import { NATIVE_GLUE_PATHS } from './native-glue.js';
import type { NativeProjects } from './native-projects.js';
import { resolveNativeProjects } from './native-projects.js';
import {
  checkSdkPackage,
  installSdkPackage,
  isSdkPackageDeclared,
} from './sdk-package.js';
import type {
  BuildDirectory,
  FrameworkModule,
  FrameworkProject,
  FrameworkWiring,
  NativeProjectPaths,
  WiringOptions,
} from './index.js';

/**
 * `capacitor.config.json` or `.ts` as text, since the TypeScript form is code: the values are matched, never evaluated.
 */
interface CapacitorConfig {
  fileName: string;
  text: string;
}

const BINARY_CREATE_SCRIPT_PATH = `node_modules/${CAPACITOR_PACKAGE_NAME}/scripts/binary-create-xcode.sh`;

export const CAPACITOR_CONFIG_FILE_NAMES = [
  'capacitor.config.json',
  'capacitor.config.ts',
];

/**
 * Capacitor: the web build at `webDir`, the native projects at `ios/` and `android/`, and the build step inside the
 * native build, an Xcode phase and the Gradle file the SDK ships, which write the resource file into the app they build.
 */
export const capacitorFramework: FrameworkModule = {
  nativeGluePaths: NATIVE_GLUE_PATHS,
  packageName: CAPACITOR_PACKAGE_NAME,
  versionedPackageNames: ['@capacitor/core', CAPACITOR_PACKAGE_NAME],
  checkWiring: project => [
    checkSdkPackage(project, CAPACITOR_PACKAGE_NAME),
    checkBinaryCreateStep(
      project.directoryPath,
      resolveNativeProjectPaths(project.directoryPath),
      CAPACITOR_PACKAGE_NAME,
    ),
  ],
  readBuildDirectory: readWebDir,
  resolveNativeProjectPaths,
  resolveWiring,
};

function readCapacitorConfig(
  projectDirectoryPath: string,
): CapacitorConfig | undefined {
  for (const fileName of CAPACITOR_CONFIG_FILE_NAMES) {
    const filePath = join(projectDirectoryPath, fileName);
    if (existsSync(filePath)) {
      return { fileName, text: readFileSync(filePath, 'utf8') };
    }
  }
  return undefined;
}

function readConfigValue(
  capacitorConfig: CapacitorConfig | undefined,
  pattern: RegExp,
): string | undefined {
  return capacitorConfig === undefined
    ? undefined
    : pattern.exec(capacitorConfig.text)?.[1];
}

/**
 * Capacitor's `webDir` as `capacitor.config` sets it when the upload runs, the web build an upload packages by default;
 * a config the CLI cannot read it from is the reason `--path` must name the build.
 */
function readWebDir(projectDirectoryPath: string): BuildDirectory {
  const capacitorConfig = readCapacitorConfig(projectDirectoryPath);
  if (capacitorConfig === undefined) {
    return {
      missingReason: `there is no ${CAPACITOR_CONFIG_FILE_NAMES.join(' or ')} to read webDir from`,
    };
  }
  const webDir = readConfigValue(
    capacitorConfig,
    /webDir['"]?\s*:\s*['"]([^'"]+)['"]/,
  );
  return webDir === undefined
    ? {
        missingReason: `${capacitorConfig.fileName} sets no webDir the CLI can read as a quoted string`,
      }
    : { path: webDir };
}

/**
 * `ios.path` and `android.path` of `capacitor.config`, or `ios/` and `android/` beside `package.json`.
 */
function resolveNativeProjectPaths(
  projectDirectoryPath: string,
): NativeProjectPaths {
  const capacitorConfig = readCapacitorConfig(projectDirectoryPath);
  return {
    android: join(
      projectDirectoryPath,
      readConfigValue(
        capacitorConfig,
        /android:\s*\{[^}]*?path:\s*['"]([^'"]+)['"]/,
      ) ?? 'android',
    ),
    ios: join(
      projectDirectoryPath,
      readConfigValue(
        capacitorConfig,
        /ios:\s*\{[^}]*?path:\s*['"]([^'"]+)['"]/,
      ) ?? 'ios',
    ),
  };
}

/**
 * The phase runs the SDK package's script, which finds Node itself, after the app target's last phase, once the web
 * build is copied into the app; `PROJECT_ROOT` is the project's directory as seen from the Xcode project's.
 */
function resolveBinaryCreatePhase(
  projectDirectoryPath: string,
  xcodeProjectFilePath: string,
): BinaryCreatePhase {
  const projectRootPath = relative(
    dirname(dirname(xcodeProjectFilePath)),
    projectDirectoryPath,
  )
    .split(sep)
    .join('/');
  return {
    anchorPhaseName: undefined,
    fix: `add a Run Script phase after the app target's last phase that runs ${BINARY_CREATE_SCRIPT_PATH}.`,
    // the lines of the phase as a pbxproj string carries them, the line breaks escaped
    shellScript: [
      'set -e',
      '',
      '# hotcodepush: writes hotcodepush.json into the app and, in a store build, creates the binary',
      `PROJECT_ROOT="$PROJECT_DIR${projectRootPath === '' ? '' : `/${projectRootPath}`}"`,
      'export PROJECT_ROOT',
      `/bin/sh "$PROJECT_ROOT/${BINARY_CREATE_SCRIPT_PATH}"`,
      '',
    ].join('\\n'),
  };
}

async function resolveWiring(
  { directoryPath, packageJson }: FrameworkProject,
  options: WiringOptions,
): Promise<FrameworkWiring> {
  const nativeProjects = await resolveNativeProjects(
    directoryPath,
    resolveNativeProjectPaths(directoryPath),
    options,
    'run "npx cap add ios" and "npx cap add android", or ',
  );
  const xcodeProjectFilePath = resolveXcodeProjectFilePath(nativeProjects.ios);
  const isPackageInstalled = isSdkPackageDeclared(
    packageJson,
    CAPACITOR_PACKAGE_NAME,
  );
  return {
    isPackageInstalled,
    nativeFilePaths: [
      ...new Set([
        ...(xcodeProjectFilePath === undefined ||
        hasBinaryCreatePhase(xcodeProjectFilePath)
          ? []
          : [xcodeProjectFilePath]),
        ...resolvePendingEdits(nativeProjects, xcodeProjectFilePath).map(
          ({ filePath }) => filePath,
        ),
      ]),
    ].map(filePath => relative(directoryPath, filePath)),
    packageFilePaths: isPackageInstalled ? [] : ['package.json'],
    installPackage: () =>
      installSdkPackage(
        directoryPath,
        CAPACITOR_PACKAGE_NAME,
        CAPACITOR_PACKAGE_SPEC,
      ),
    wireBinaryCreateStep: editBlocker =>
      wireBinaryCreateStep(
        directoryPath,
        nativeProjects,
        xcodeProjectFilePath,
        editBlocker,
        options,
      ),
  };
}

/**
 * The edits besides the phase not made yet: the `hotcodepush.json` reference an earlier `init` added to the Xcode project
 * removed, since the build writes the file into the app now, and the Gradle line.
 */
function resolvePendingEdits(
  nativeProjectPaths: NativeProjectPaths,
  xcodeProjectFilePath: string | undefined,
): NativeProjectEdit[] {
  return [
    xcodeProjectFilePath === undefined
      ? undefined
      : resolveResourceReferenceEdit(xcodeProjectFilePath),
    resolveGradleEdit(nativeProjectPaths.android, CAPACITOR_PACKAGE_NAME),
  ]
    .filter(edit => edit !== undefined)
    .filter(edit => !edit.isApplied());
}

function resolveResourceReferenceEdit(
  xcodeProjectFilePath: string,
): NativeProjectEdit {
  return {
    description: 'the Xcode project without its hotcodepush.json reference',
    filePath: xcodeProjectFilePath,
    isApplied: () => !hasReadableResourceReference(xcodeProjectFilePath),
    apply: () => {
      removeResourceReference(xcodeProjectFilePath);
    },
  };
}

/**
 * The Xcode phase, the old reference's removal and the Gradle line, each left alone when done. An edit a file has no place
 * for does not hold the others back: they are made, and the step stops with the first one's manual step.
 */
async function wireBinaryCreateStep(
  projectDirectoryPath: string,
  nativeProjects: NativeProjects,
  xcodeProjectFilePath: string | undefined,
  editBlocker: ConfirmationRequiredError | undefined,
  options: WiringOptions,
): Promise<StepOutcome<undefined>> {
  if (nativeProjects.missingError !== undefined) {
    throw nativeProjects.missingError;
  }
  const isPhaseWired =
    xcodeProjectFilePath === undefined ||
    hasBinaryCreatePhase(xcodeProjectFilePath);
  const pendingEdits = resolvePendingEdits(
    nativeProjects,
    xcodeProjectFilePath,
  );
  if (isPhaseWired && pendingEdits.length === 0) {
    return {
      message: 'the Xcode phase and the Gradle task already wired',
      status: 'skipped',
      value: undefined,
    };
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  const wired = await applyNativeProjectEdits(
    xcodeProjectFilePath === undefined
      ? undefined
      : {
          phase: resolveBinaryCreatePhase(
            projectDirectoryPath,
            xcodeProjectFilePath,
          ),
          projectFilePath: xcodeProjectFilePath,
        },
    pendingEdits,
    options,
  );
  return {
    message: `wired ${wired.join(', ')}`,
    status: 'done',
    value: undefined,
  };
}
