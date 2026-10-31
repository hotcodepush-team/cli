import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXPO_PACKAGE_NAME,
  EXPO_PACKAGE_SPEC,
  INIT_MANUAL_STEP,
  REACT_NATIVE_PACKAGE_NAME,
} from '../../config/consts.js';
import type { ConfirmationRequiredError } from '../errors.js';
import { NativeProjectError } from '../errors.js';
import type { StepOutcome } from '../init-steps.js';
import { stringifyLikeSource } from '../json-file.js';
import {
  collectEmbeddedFiles,
  packageReactNativeBundles,
  readBuildDirectory,
} from './react-native-build.js';
import {
  checkSdkPackage,
  installSdkPackage,
  isSdkPackageDeclared,
} from './sdk-package.js';
import type {
  FrameworkCheck,
  FrameworkModule,
  FrameworkProject,
  FrameworkWiring,
} from './index.js';

// Each plugin is a name or a name with its options.
interface AppConfig {
  plugins?: unknown[];
}

interface AppConfigFileNames {
  codeFileName: string | undefined;
  jsonFileName: string;
}

// Expo reads the config under the `expo` key, or the whole file when that key is missing.
interface AppJson extends AppConfig {
  expo?: AppConfig;
}

const APP_JSON_FILE_NAME = 'app.json';

// Expo's native release builds run this bundler, and it resolves the entry file itself.
const BUNDLER_ARGS = ['expo', 'export:embed'];

// Both lists are in the order Expo prefers.
const CODE_APP_CONFIG_FILE_NAMES = [
  'app.config.ts',
  'app.config.mts',
  'app.config.cts',
  'app.config.mjs',
  'app.config.cjs',
  'app.config.js',
];

const JSON_APP_CONFIG_FILE_NAMES = ['app.config.json', APP_JSON_FILE_NAME];

// The config plugin wires the native projects at prebuild, so `init` only adds one entry to the app config.
export const expoFramework: FrameworkModule = {
  packageName: EXPO_PACKAGE_NAME,
  versionedPackageNames: ['expo', 'react-native', EXPO_PACKAGE_NAME],
  versionedSdkDependencyNames: [REACT_NATIVE_PACKAGE_NAME],
  checkWiring: project => [
    checkSdkPackage(project, EXPO_PACKAGE_NAME),
    checkPluginEntry(project),
  ],
  collectEmbeddedFiles,
  packageBundles: request =>
    packageReactNativeBundles(request, () => BUNDLER_ARGS),
  readBuildDirectory,
  resolveWiring: project => Promise.resolve(resolveWiring(project)),
};

function addPluginEntry(filePath: string): void {
  // A project without an app config gets one, as Expo's own install writes it.
  const appJsonText = existsSync(filePath)
    ? readFileSync(filePath, 'utf8')
    : '{}';
  const appJson = JSON.parse(appJsonText) as AppJson;
  const appConfig = appJson.expo ?? appJson;
  appConfig.plugins = [...(appConfig.plugins ?? []), EXPO_PACKAGE_NAME];
  writeFileSync(filePath, stringifyLikeSource(appJson, appJsonText));
}

function checkPluginEntry({ directoryPath }: FrameworkProject): FrameworkCheck {
  const appConfigFileNames = findAppConfigFileNames(directoryPath);
  const pluginEntryFileName = findPluginEntryFileName(
    directoryPath,
    appConfigFileNames,
  );
  if (pluginEntryFileName !== undefined) {
    return {
      check: 'hook',
      message: `The app config ${pluginEntryFileName} lists the config plugin, which wires the build step at prebuild.`,
      status: 'ok',
    };
  }
  const { codeFileName, jsonFileName } = appConfigFileNames;
  const appConfigFileName = codeFileName ?? jsonFileName;
  return {
    check: 'hook',
    code: 'wiring_missing',
    manualStep: isPluginEntryEditable(directoryPath, appConfigFileNames)
      ? INIT_MANUAL_STEP
      : resolvePluginEntryStep(appConfigFileName),
    message: `The app config ${appConfigFileName} does not list the config plugin ${EXPO_PACKAGE_NAME}.`,
    status: 'failed',
  };
}

function findAppConfigFileNames(
  projectDirectoryPath: string,
): AppConfigFileNames {
  const isPresent = (fileName: string): boolean =>
    existsSync(join(projectDirectoryPath, fileName));
  return {
    codeFileName: CODE_APP_CONFIG_FILE_NAMES.find(isPresent),
    jsonFileName:
      JSON_APP_CONFIG_FILE_NAMES.find(isPresent) ?? APP_JSON_FILE_NAME,
  };
}

// An entry in the JSON config counts beside a code config too, since Expo hands its config to the code.
function findPluginEntryFileName(
  projectDirectoryPath: string,
  { codeFileName, jsonFileName }: AppConfigFileNames,
): string | undefined {
  return [codeFileName, jsonFileName].find(
    fileName =>
      fileName !== undefined && hasPluginEntry(projectDirectoryPath, fileName),
  );
}

// A code or JSON5 config is never evaluated, so the package name is matched in its text.
function hasPluginEntry(
  projectDirectoryPath: string,
  appConfigFileName: string,
): boolean {
  const filePath = join(projectDirectoryPath, appConfigFileName);
  if (!existsSync(filePath)) {
    return false;
  }
  const appConfigText = readFileSync(filePath, 'utf8');
  const appJson = JSON_APP_CONFIG_FILE_NAMES.includes(appConfigFileName)
    ? parseAppJson(appConfigText)
    : undefined;
  if (appJson === undefined) {
    return appConfigText.includes(EXPO_PACKAGE_NAME);
  }
  return ((appJson.expo ?? appJson).plugins ?? []).some(
    plugin =>
      (Array.isArray(plugin) ? plugin[0] : plugin) === EXPO_PACKAGE_NAME,
  );
}

// Expo also reads JSON5, which does not parse as JSON. The person adds the entry there and beside a code config.
function isPluginEntryEditable(
  projectDirectoryPath: string,
  { codeFileName, jsonFileName }: AppConfigFileNames,
): boolean {
  const jsonFilePath = join(projectDirectoryPath, jsonFileName);
  return (
    codeFileName === undefined &&
    (!existsSync(jsonFilePath) ||
      parseAppJson(readFileSync(jsonFilePath, 'utf8')) !== undefined)
  );
}

function parseAppJson(appJsonText: string): AppJson | undefined {
  try {
    return JSON.parse(appJsonText) as AppJson;
  } catch {
    return undefined;
  }
}

function resolvePluginEntryStep(appConfigFileName: string): string {
  return `Add "${EXPO_PACKAGE_NAME}" to the plugins in ${appConfigFileName}.`;
}

function resolveWiring({
  directoryPath,
  packageJson,
}: FrameworkProject): FrameworkWiring {
  const isPackageInstalled = isSdkPackageDeclared(
    packageJson,
    EXPO_PACKAGE_NAME,
  );
  const appConfigFileNames = findAppConfigFileNames(directoryPath);
  const isAppJsonToEdit =
    isPluginEntryEditable(directoryPath, appConfigFileNames) &&
    findPluginEntryFileName(directoryPath, appConfigFileNames) === undefined;
  return {
    isPackageInstalled,
    nativeFilePaths: [],
    packageFilePaths: [
      ...(isPackageInstalled ? [] : ['package.json']),
      ...(isAppJsonToEdit ? [appConfigFileNames.jsonFileName] : []),
    ],
    installPackage: () =>
      installSdkPackage(directoryPath, EXPO_PACKAGE_NAME, EXPO_PACKAGE_SPEC),
    wireBinaryCreateStep: editBlocker =>
      wirePluginEntry(directoryPath, appConfigFileNames, editBlocker),
  };
}

async function wirePluginEntry(
  projectDirectoryPath: string,
  appConfigFileNames: AppConfigFileNames,
  editBlocker: ConfirmationRequiredError | undefined,
): Promise<StepOutcome<undefined>> {
  const pluginEntryFileName = findPluginEntryFileName(
    projectDirectoryPath,
    appConfigFileNames,
  );
  if (pluginEntryFileName !== undefined) {
    return {
      message: `The app config ${pluginEntryFileName} already lists the config plugin.`,
      status: 'skipped',
      value: undefined,
    };
  }
  const { codeFileName, jsonFileName } = appConfigFileNames;
  if (codeFileName !== undefined) {
    throw new NativeProjectError(
      `The app config ${codeFileName} is code, which the CLI does not edit.`,
      resolvePluginEntryStep(codeFileName),
    );
  }
  if (!isPluginEntryEditable(projectDirectoryPath, appConfigFileNames)) {
    throw new NativeProjectError(
      `The app config ${jsonFileName} is not JSON the CLI can parse.`,
      resolvePluginEntryStep(jsonFileName),
    );
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  addPluginEntry(join(projectDirectoryPath, jsonFileName));
  return {
    message: `Added the config plugin ${EXPO_PACKAGE_NAME} to ${jsonFileName}.`,
    status: 'done',
    value: undefined,
  };
}
