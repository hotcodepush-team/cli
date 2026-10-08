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
 * The app configs of a project by file name: the JSON one, `app.json` where the project has none yet, and the one that
 * is code where the project has one, which Expo hands the JSON one's config.
 */
interface AppConfigFileNames {
  codeFileName: string | undefined;
  jsonFileName: string;
}

/**
 * A JSON app config, whose config Expo reads under the `expo` key, or the whole file where it has none.
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
 * The app configs that are code, in the order Expo prefers them.
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
 * The app configs that are JSON, in the order Expo prefers them.
 */
const JSON_APP_CONFIG_FILE_NAMES = ['app.config.json', APP_JSON_FILE_NAME];

/**
 * Expo: React Native's SDK and release build, wired by the config plugin at prebuild, so `init` adds one entry to the
 * app config and the native projects stay prebuild's. An upload bundles each platform with Expo's own bundler.
 */
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
  readBuildDirectory: () => undefined,
  resolveMainBundlePath,
  resolveNativeProjectPaths,
  resolveWiring: project => Promise.resolve(resolveWiring(project)),
};

function addPluginEntry(filePath: string): void {
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
  const appConfigFileNames = findAppConfigFileNames(directoryPath);
  const pluginEntryFileName = findPluginEntryFileName(
    directoryPath,
    appConfigFileNames,
  );
  if (pluginEntryFileName !== undefined) {
    return {
      check: 'hook',
      message: `${pluginEntryFileName} lists the config plugin, which wires binary create at prebuild`,
      status: 'ok',
    };
  }
  const { codeFileName, jsonFileName } = appConfigFileNames;
  const appConfigFileName = codeFileName ?? jsonFileName;
  return {
    check: 'hook',
    manualStep: isPluginEntryEditable(directoryPath, appConfigFileNames)
      ? INIT_MANUAL_STEP
      : resolvePluginEntryStep(appConfigFileName),
    message: `${appConfigFileName} does not list the config plugin ${EXPO_PACKAGE_NAME}`,
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

/**
 * The app config that lists the plugin, the one that is code first; an entry in the JSON one counts beside code too,
 * since Expo hands its config to the code.
 */
function findPluginEntryFileName(
  projectDirectoryPath: string,
  { codeFileName, jsonFileName }: AppConfigFileNames,
): string | undefined {
  return [codeFileName, jsonFileName].find(
    fileName =>
      fileName !== undefined && hasPluginEntry(projectDirectoryPath, fileName),
  );
}

/**
 * Whether an app config lists the plugin: by name or with its options in the plugins of a JSON config the CLI parses,
 * and otherwise — a config that is code, a JSON5 one — by the package's name in its text, matched and never evaluated.
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

/**
 * Whether `init` adds the entry itself, to the JSON app config it creates or parses; beside a config that is code, and
 * in a JSON one that does not parse, such as the JSON5 Expo reads too, the entry is the person's to add.
 */
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

/**
 * The plugin entry in the JSON app config, left alone when either app config lists it; a config that is code and a
 * JSON one that does not parse are the person's to edit, so their entry is the manual step.
 */
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
      message: `${pluginEntryFileName} already lists the config plugin`,
      status: 'skipped',
      value: undefined,
    };
  }
  const { codeFileName, jsonFileName } = appConfigFileNames;
  if (codeFileName !== undefined) {
    throw new NativeProjectError(
      `${codeFileName} is code the CLI does not edit`,
      `${resolvePluginEntryStep(codeFileName)}.`,
    );
  }
  if (!isPluginEntryEditable(projectDirectoryPath, appConfigFileNames)) {
    throw new NativeProjectError(
      `${jsonFileName} is not JSON the CLI can parse`,
      `${resolvePluginEntryStep(jsonFileName)}.`,
    );
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  addPluginEntry(join(projectDirectoryPath, jsonFileName));
  return {
    message: `added the config plugin ${EXPO_PACKAGE_NAME} to ${jsonFileName}`,
    status: 'done',
    value: undefined,
  };
}
