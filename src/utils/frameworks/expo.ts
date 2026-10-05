import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPO_PACKAGE_NAME, EXPO_PACKAGE_SPEC } from '../../config/consts.js';
import { stringifyLikeSource } from '../binary-create-hook.js';
import type { ConfirmationRequiredError } from '../errors.js';
import { NativeProjectError } from '../errors.js';
import type { StepOutcome } from '../init-steps.js';
import {
  collectEmbeddedFiles,
  packageReactNativeBundles,
  readBinaryIdentity,
  resolveMainBundlePath,
  resolveNativeProjectPaths,
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

/**
 * The part of an app config `init` edits: its plugins, each a name or a name with its options.
 */
interface AppConfig {
  plugins?: unknown[];
}

/**
 * `app.json`, whose config Expo reads under the `expo` key, or the whole file where it has none.
 */
interface AppJson extends AppConfig {
  expo?: AppConfig;
}

const APP_JSON_FILE_NAME = 'app.json';

/**
 * Expo's export for embedding, the bundler its native release builds run, which resolves the entry file as they do.
 */
const BUNDLER_ARGS = ['expo', 'export:embed'];

/**
 * The app configs that are code, in the order Expo prefers them over `app.json`.
 */
const CODE_APP_CONFIG_FILE_NAMES = [
  'app.config.ts',
  'app.config.mts',
  'app.config.cts',
  'app.config.mjs',
  'app.config.cjs',
  'app.config.js',
];

/**
 * Expo: React Native's SDK and release build, wired by the config plugin at prebuild, so `init` adds one entry to the
 * app config and the native projects stay prebuild's. An upload bundles each platform with Expo's own bundler.
 */
export const expoFramework: FrameworkModule = {
  binaryCreateStep:
    'run npx expo prebuild and build the app natively, which runs binary create',
  packageName: EXPO_PACKAGE_NAME,
  versionedPackageNames: ['expo', 'react-native', EXPO_PACKAGE_NAME],
  checkWiring: project => [
    checkSdkPackage(project, EXPO_PACKAGE_NAME),
    checkPluginEntry(project),
  ],
  collectEmbeddedFiles,
  packageBundles: request =>
    packageReactNativeBundles(request, () => BUNDLER_ARGS),
  readBinaryIdentity,
  readBuildDirectory: () => undefined,
  resolveMainBundlePath,
  resolveNativeProjectPaths,
  resolveResourceFilePath: () => undefined,
  resolveWiring: project => Promise.resolve(resolveWiring(project)),
};

function addPluginEntry(projectDirectoryPath: string): void {
  const filePath = join(projectDirectoryPath, APP_JSON_FILE_NAME);
  // a project without an app config gets one, as Expo's own install writes it
  const appJsonText = existsSync(filePath)
    ? readFileSync(filePath, 'utf8')
    : '{}';
  const appJson = JSON.parse(appJsonText) as AppJson;
  const appConfig = appJson.expo ?? appJson;
  appConfig.plugins = [...(appConfig.plugins ?? []), EXPO_PACKAGE_NAME];
  writeFileSync(filePath, stringifyLikeSource(appJson, appJsonText));
}

/**
 * `doctor`'s `hook` row: the app config lists the plugin, which wires binary create into the native builds at prebuild.
 */
function checkPluginEntry({ directoryPath }: FrameworkProject): FrameworkCheck {
  const appConfigFileName = findAppConfigFileName(directoryPath);
  if (hasPluginEntry(directoryPath, appConfigFileName)) {
    return {
      check: 'hook',
      message: `${appConfigFileName} lists the config plugin, which wires binary create at prebuild`,
      status: 'ok',
    };
  }
  return {
    check: 'hook',
    manualStep:
      appConfigFileName === APP_JSON_FILE_NAME
        ? 'run hotcodepush init'
        : resolvePluginEntryStep(appConfigFileName),
    message: `${appConfigFileName} does not list the config plugin ${EXPO_PACKAGE_NAME}`,
    status: 'failed',
  };
}

/**
 * The app config Expo reads: the first one that is code, `app.json` otherwise.
 */
function findAppConfigFileName(projectDirectoryPath: string): string {
  return (
    CODE_APP_CONFIG_FILE_NAMES.find(fileName =>
      existsSync(join(projectDirectoryPath, fileName)),
    ) ?? APP_JSON_FILE_NAME
  );
}

/**
 * Whether the app config lists the plugin: by name or with its options in `app.json`'s plugins, and in a config that
 * is code by the package's name in its text, matched and never evaluated.
 */
function hasPluginEntry(
  projectDirectoryPath: string,
  appConfigFileName: string,
): boolean {
  const filePath = join(projectDirectoryPath, appConfigFileName);
  if (!existsSync(filePath)) {
    return false;
  }
  const appConfigText = readFileSync(filePath, 'utf8');
  if (appConfigFileName !== APP_JSON_FILE_NAME) {
    return appConfigText.includes(EXPO_PACKAGE_NAME);
  }
  const appJson = JSON.parse(appConfigText) as AppJson;
  return ((appJson.expo ?? appJson).plugins ?? []).some(
    plugin =>
      (Array.isArray(plugin) ? plugin[0] : plugin) === EXPO_PACKAGE_NAME,
  );
}

function resolvePluginEntryStep(appConfigFileName: string): string {
  return `add "${EXPO_PACKAGE_NAME}" to the plugins in ${appConfigFileName}`;
}

function resolveWiring({
  directoryPath,
  packageJson,
}: FrameworkProject): FrameworkWiring {
  const isPackageInstalled = isSdkPackageDeclared(
    packageJson,
    EXPO_PACKAGE_NAME,
  );
  const appConfigFileName = findAppConfigFileName(directoryPath);
  const isAppJsonToEdit =
    appConfigFileName === APP_JSON_FILE_NAME &&
    !hasPluginEntry(directoryPath, appConfigFileName);
  return {
    isPackageInstalled,
    nativeFilePaths: [],
    packageFilePaths: [
      ...(isPackageInstalled ? [] : ['package.json']),
      ...(isAppJsonToEdit ? [APP_JSON_FILE_NAME] : []),
    ],
    installPackage: () =>
      installSdkPackage(directoryPath, EXPO_PACKAGE_NAME, EXPO_PACKAGE_SPEC),
    wireBinaryCreateStep: editBlocker =>
      wirePluginEntry(directoryPath, appConfigFileName, editBlocker),
  };
}

/**
 * The plugin entry in `app.json`, left alone when present; a config that is code is the person's to edit, so its
 * entry is the manual step.
 */
async function wirePluginEntry(
  projectDirectoryPath: string,
  appConfigFileName: string,
  editBlocker: ConfirmationRequiredError | undefined,
): Promise<StepOutcome<undefined>> {
  if (hasPluginEntry(projectDirectoryPath, appConfigFileName)) {
    return {
      message: `${appConfigFileName} already lists the config plugin`,
      status: 'skipped',
      value: undefined,
    };
  }
  if (appConfigFileName !== APP_JSON_FILE_NAME) {
    throw new NativeProjectError(
      `${appConfigFileName} is code the CLI does not edit`,
      `${resolvePluginEntryStep(appConfigFileName)}.`,
    );
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  addPluginEntry(projectDirectoryPath);
  return {
    message: `added the config plugin ${EXPO_PACKAGE_NAME} to ${APP_JSON_FILE_NAME}`,
    status: 'done',
    value: undefined,
  };
}
