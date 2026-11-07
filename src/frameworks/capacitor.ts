import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  CAPACITOR_PACKAGE_NAME,
  CAPACITOR_PACKAGE_SPEC,
} from '../config/consts.js';
import type { ConfirmationRequiredError } from '../utils/errors.js';
import { EntryFileError } from '../utils/errors.js';
import type {
  BinaryCreatePhaseEdit,
  LocatedNativeProjects,
} from './binary-create-step.js';
import {
  applyNativeProjectEdits,
  checkBinaryCreateStep,
  isBinaryCreatePhaseMissing,
  resolveWiredOutcome,
} from './binary-create-step.js';
import {
  isSdkImported,
  resolveEntryFilePath,
  WEB_SOURCE_DIRECTORY_NAME,
  writeSdkImport,
} from './capacitor-entry-file.js';
import { NATIVE_GLUE_PATHS } from './native-glue.js';
import type { NativeProjectEdit } from './native-project-edit.js';
import { resolveGradleEdit } from './native-project-edit.js';
import { locateNativeProjects } from './native-projects.js';
import {
  checkSdkPackage,
  installSdkPackage,
  isSdkPackageDeclared,
} from './sdk-package.js';
import type { BinaryCreatePhase } from './xcode-project.js';
import {
  buildPbxprojShellScript,
  hasReadableResourceReference,
  removeResourceReference,
  resolveXcodeProjectFilePath,
} from './xcode-project.js';
import type {
  BuildDirectory,
  FrameworkCheck,
  FrameworkModule,
  FrameworkProject,
  FrameworkWiring,
  NativeProjectPaths,
  StepOutcome,
  WiringOptions,
} from './index.js';

// The TypeScript config is code, so its values are matched as text, never evaluated.
interface CapacitorConfig {
  fileName: string;
  text: string;
}

interface CapacitorNativeProjects extends LocatedNativeProjects {
  projectDirectoryPath: string;
}

const ALREADY_IMPORTED_OUTCOME: StepOutcome<undefined> = {
  message: `The app's code already imports ${CAPACITOR_PACKAGE_NAME}.`,
  status: 'skipped',
  value: undefined,
};

const ALREADY_WIRED_OUTCOME: StepOutcome<undefined> = {
  message: 'The Xcode phase and the Gradle task are already wired.',
  status: 'skipped',
  value: undefined,
};

const BINARY_CREATE_SCRIPT_PATH = `node_modules/${CAPACITOR_PACKAGE_NAME}/scripts/binary-create-xcode.sh`;

const CAPACITOR_CONFIG_FILE_NAMES = [
  'capacitor.config.json',
  'capacitor.config.ts',
];

const SDK_IMPORT_STEP = `Add "import '${CAPACITOR_PACKAGE_NAME}';" to the app's entry file, such as src/main.ts.`;

export const capacitorFramework: FrameworkModule = {
  detectionPackageName: '@capacitor/core',
  nativeGluePaths: NATIVE_GLUE_PATHS,
  packageName: CAPACITOR_PACKAGE_NAME,
  versionedPackageNames: ['@capacitor/core', CAPACITOR_PACKAGE_NAME],
  checkWiring: project => [
    checkSdkPackage(project, CAPACITOR_PACKAGE_NAME),
    checkBinaryCreateStep(project.directoryPath, {
      nativeProjectPaths: resolveNativeProjectPaths(project.directoryPath),
      packageName: CAPACITOR_PACKAGE_NAME,
    }),
    checkSdkImport(project.directoryPath),
  ],
  hasConfigFile: projectDirectoryPath =>
    CAPACITOR_CONFIG_FILE_NAMES.some(fileName =>
      existsSync(join(projectDirectoryPath, fileName)),
    ),
  readBuildDirectory: readWebDir,
  resolveWiring,
};

function checkSdkImport(projectDirectoryPath: string): FrameworkCheck {
  const entryFilePath = resolveEntryFilePath(projectDirectoryPath);
  if (
    entryFilePath === undefined &&
    !existsSync(join(projectDirectoryPath, WEB_SOURCE_DIRECTORY_NAME))
  ) {
    return {
      check: 'import',
      message: `There is no ${WEB_SOURCE_DIRECTORY_NAME}/ directory and no entry file to look for the import in.`,
      status: 'skipped',
    };
  }
  return isSdkImported(projectDirectoryPath, { entryFilePath })
    ? {
        check: 'import',
        message: `The app's code imports ${CAPACITOR_PACKAGE_NAME}.`,
        status: 'ok',
      }
    : {
        check: 'import',
        code: 'import_missing',
        manualStep: SDK_IMPORT_STEP,
        message: `The app's code does not import ${CAPACITOR_PACKAGE_NAME}, so it confirms no update.`,
        status: 'failed',
      };
}

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

function resolveAppFilePaths(
  projectDirectoryPath: string,
  {
    entryFilePath,
    isImported,
  }: { entryFilePath: string | undefined; isImported: boolean },
): string[] {
  return entryFilePath === undefined || isImported
    ? []
    : [relative(projectDirectoryPath, entryFilePath)];
}

// The phase runs last, once the web build is copied into the app. The script finds Node itself.
function resolveBinaryCreatePhase(
  projectDirectoryPath: string,
  { xcodeProjectFilePath }: { xcodeProjectFilePath: string },
): BinaryCreatePhase {
  const projectRootPath = relative(
    dirname(dirname(xcodeProjectFilePath)),
    projectDirectoryPath,
  )
    .split(sep)
    .join('/');
  return {
    anchorPhaseName: undefined,
    fix: `Add a Run Script phase after the app target's last phase that runs ${BINARY_CREATE_SCRIPT_PATH}.`,
    shellScript: buildPbxprojShellScript([
      'set -e',
      '',
      '# hotcodepush: writes hotcodepush.json into the app and, in a store build, creates the binary',
      `PROJECT_ROOT="$PROJECT_DIR${projectRootPath === '' ? '' : `/${projectRootPath}`}"`,
      'export PROJECT_ROOT',
      `/bin/sh "$PROJECT_ROOT/${BINARY_CREATE_SCRIPT_PATH}"`,
      '',
    ]),
  };
}

function resolveNativeFilePaths({
  nativeProjects,
  projectDirectoryPath,
  xcodeProjectFilePath,
}: CapacitorNativeProjects): string[] {
  const nativeFilePaths = new Set([
    ...(isBinaryCreatePhaseMissing(xcodeProjectFilePath)
      ? [xcodeProjectFilePath]
      : []),
    ...resolvePendingEdits(nativeProjects, { xcodeProjectFilePath })
      .filter(edit => !edit.isRefused)
      .map(({ filePath }) => filePath),
  ]);
  return [...nativeFilePaths].map(filePath =>
    relative(projectDirectoryPath, filePath),
  );
}

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

function resolvePendingEdits(
  nativeProjectPaths: NativeProjectPaths,
  { xcodeProjectFilePath }: { xcodeProjectFilePath: string | undefined },
): NativeProjectEdit[] {
  return [
    xcodeProjectFilePath === undefined
      ? undefined
      : resolveResourceReferenceEdit(xcodeProjectFilePath),
    resolveGradleEdit(nativeProjectPaths.android, {
      packageName: CAPACITOR_PACKAGE_NAME,
    }),
  ]
    .filter(edit => edit !== undefined)
    .filter(edit => !edit.isApplied());
}

function resolvePhaseEdit({
  projectDirectoryPath,
  xcodeProjectFilePath,
}: CapacitorNativeProjects): BinaryCreatePhaseEdit | undefined {
  return xcodeProjectFilePath === undefined
    ? undefined
    : {
        phase: resolveBinaryCreatePhase(projectDirectoryPath, {
          xcodeProjectFilePath,
        }),
        projectFilePath: xcodeProjectFilePath,
      };
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

async function resolveWiring(
  { directoryPath, packageJson }: FrameworkProject,
  options: WiringOptions,
): Promise<FrameworkWiring> {
  const nativeProjects = await locateNativeProjects(options, {
    defaultPaths: resolveNativeProjectPaths(directoryPath),
    missingProjectsStep:
      'Run "npx cap add ios" and "npx cap add android", or pass --ios-path and --android-path.',
    projectDirectoryPath: directoryPath,
  });
  const located = {
    nativeProjects,
    projectDirectoryPath: directoryPath,
    xcodeProjectFilePath: resolveXcodeProjectFilePath(nativeProjects.ios),
  };
  const isPackageInstalled = isSdkPackageDeclared(
    packageJson,
    CAPACITOR_PACKAGE_NAME,
  );
  const entryFilePath = resolveEntryFilePath(directoryPath);
  const isImported = isSdkImported(directoryPath, { entryFilePath });
  return {
    appFilePaths: resolveAppFilePaths(directoryPath, {
      entryFilePath,
      isImported,
    }),
    isPackageInstalled,
    nativeFilePaths: resolveNativeFilePaths(located),
    packageFilePaths: isPackageInstalled ? [] : ['package.json'],
    installPackage: () =>
      installSdkPackage(directoryPath, {
        packageName: CAPACITOR_PACKAGE_NAME,
        packageSpec: CAPACITOR_PACKAGE_SPEC,
      }),
    wireAppImport: editBlocker =>
      wireAppImport(directoryPath, { editBlocker, entryFilePath, isImported }),
    wireBinaryCreateStep: editBlocker =>
      wireBinaryCreateStep(located, { editBlocker, options }),
  };
}

async function wireAppImport(
  projectDirectoryPath: string,
  {
    editBlocker,
    entryFilePath,
    isImported,
  }: {
    editBlocker: ConfirmationRequiredError | undefined;
    entryFilePath: string | undefined;
    isImported: boolean;
  },
): Promise<StepOutcome<undefined>> {
  if (isImported) {
    return ALREADY_IMPORTED_OUTCOME;
  }
  if (entryFilePath === undefined) {
    throw new EntryFileError({ fix: SDK_IMPORT_STEP });
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  writeSdkImport(entryFilePath);
  return {
    message: `Wired the import in ${relative(projectDirectoryPath, entryFilePath)}.`,
    status: 'done',
    value: undefined,
  };
}

async function wireBinaryCreateStep(
  located: CapacitorNativeProjects,
  {
    editBlocker,
    options,
  }: {
    editBlocker: ConfirmationRequiredError | undefined;
    options: WiringOptions;
  },
): Promise<StepOutcome<undefined>> {
  const { nativeProjects, xcodeProjectFilePath } = located;
  if (nativeProjects.missingError !== undefined) {
    throw nativeProjects.missingError;
  }
  const pendingEdits = resolvePendingEdits(nativeProjects, {
    xcodeProjectFilePath,
  });
  if (
    !isBinaryCreatePhaseMissing(xcodeProjectFilePath) &&
    pendingEdits.length === 0
  ) {
    return ALREADY_WIRED_OUTCOME;
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  return resolveWiredOutcome(
    await applyNativeProjectEdits(pendingEdits, {
      options,
      phaseEdit: resolvePhaseEdit(located),
    }),
  );
}
