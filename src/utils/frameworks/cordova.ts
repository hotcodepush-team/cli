import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import {
  CORDOVA_PACKAGE_NAME,
  CORDOVA_PACKAGE_SPEC,
} from '../../config/consts.js';
import type { CommandLine } from '../package-manager.js';
import {
  resolveCommandLineText,
  runCommandLineVisibly,
} from '../package-manager.js';
import { NATIVE_GLUE_PATHS } from './native-glue.js';
import { checkSdkPackage, isSdkPackageDeclared } from './sdk-package.js';
import type {
  FrameworkCheck,
  FrameworkModule,
  FrameworkProject,
  FrameworkWiring,
} from './index.js';

interface PlatformSection {
  name?: string;
  preference?: Preference[];
}

interface Preference {
  name?: string;
  value?: string;
}

interface Widget {
  platform?: PlatformSection[];
  preference?: Preference[];
}

const CONFIG_FILE_NAME = 'config.xml';

const INSECURE_FILE_MODE_PREFERENCE_NAME = 'AndroidInsecureFileModeEnabled';

const LIST_TAG_NAMES = new Set(['platform', 'preference']);

const PLUGIN_ADD_COMMAND_LINE: CommandLine = {
  args: ['cordova', 'plugin', 'add', CORDOVA_PACKAGE_SPEC],
  command: 'npx',
};

const WEB_DIRECTORY = 'www';

export const cordovaFramework: FrameworkModule = {
  nativeGluePaths: NATIVE_GLUE_PATHS,
  packageName: CORDOVA_PACKAGE_NAME,
  versionedPackageNames: [
    'cordova',
    'cordova-android',
    'cordova-ios',
    CORDOVA_PACKAGE_NAME,
  ],
  checkWiring: project => [
    checkSdkPackage(project, CORDOVA_PACKAGE_NAME),
    checkHook(project),
    checkInsecureFileMode(project),
  ],
  // The start page in `config.xml` is a page inside `www`, which the app serves as its root.
  readBuildDirectory: () => ({ path: WEB_DIRECTORY }),
  resolveWiring: project => Promise.resolve(resolveWiring(project)),
};

// The plugin wires the build steps itself into each platform once `package.json` lists it among Cordova's plugins.
function checkHook({ packageJson }: FrameworkProject): FrameworkCheck {
  return isPluginListed(packageJson)
    ? {
        check: 'hook',
        message: "The plugin's Xcode phase and Gradle task run the build step.",
        status: 'ok',
      }
    : {
        check: 'hook',
        code: 'wiring_missing',
        manualStep: `Run "${resolveCommandLineText(PLUGIN_ADD_COMMAND_LINE)}".`,
        message: `The plugin ${CORDOVA_PACKAGE_NAME} is not among package.json's cordova plugins.`,
        status: 'failed',
      };
}

function checkInsecureFileMode({
  directoryPath,
}: FrameworkProject): FrameworkCheck {
  return isInsecureFileModeEnabled(readWidget(directoryPath))
    ? {
        check: 'android_file_mode',
        code: 'insecure_file_mode',
        manualStep:
          'The plugin serves no update from file:// and stays off. Remove the preference.',
        message: `The file ${CONFIG_FILE_NAME} sets ${INSECURE_FILE_MODE_PREFERENCE_NAME}, which loads the Android app from file://.`,
        status: 'failed',
      }
    : {
        check: 'android_file_mode',
        message: `The file ${CONFIG_FILE_NAME} leaves ${INSECURE_FILE_MODE_PREFERENCE_NAME} off.`,
        status: 'ok',
      };
}

// Matches how Cordova reads Android preferences: names and values ignore case, and the last one wins.
// The Android section comes after the widget's, so it wins too.
function isInsecureFileModeEnabled(widget: Widget | undefined): boolean {
  const preferences = [
    ...(widget?.preference ?? []),
    ...(widget?.platform ?? [])
      .filter(({ name }) => name === 'android')
      .flatMap(({ preference }) => preference ?? []),
  ];
  const value = preferences.findLast(
    ({ name }) =>
      name?.toLowerCase() === INSECURE_FILE_MODE_PREFERENCE_NAME.toLowerCase(),
  )?.value;
  return value?.toLowerCase() === 'true';
}

function isPluginListed(packageJson: FrameworkProject['packageJson']): boolean {
  return packageJson?.cordova?.plugins?.[CORDOVA_PACKAGE_NAME] !== undefined;
}

function readWidget(projectDirectoryPath: string): Widget | undefined {
  const configFilePath = join(projectDirectoryPath, CONFIG_FILE_NAME);
  if (!existsSync(configFilePath)) {
    return undefined;
  }
  const document = new XMLParser({
    attributeNamePrefix: '',
    ignoreAttributes: false,
    isArray: (tagName, _jPath, _isLeafNode, isAttribute) =>
      !isAttribute && LIST_TAG_NAMES.has(tagName),
    parseAttributeValue: false,
  }).parse(readFileSync(configFilePath, 'utf8')) as { widget?: Widget };
  return document.widget;
}

function resolveWiring({
  directoryPath,
  packageJson,
}: FrameworkProject): FrameworkWiring {
  const isPackageInstalled =
    isSdkPackageDeclared(packageJson, CORDOVA_PACKAGE_NAME) &&
    isPluginListed(packageJson);
  return {
    isPackageInstalled,
    nativeFilePaths: [],
    packageFilePaths: isPackageInstalled ? [] : ['package.json'],
    installPackage: () => {
      runCommandLineVisibly(PLUGIN_ADD_COMMAND_LINE, directoryPath);
      return `Installed ${CORDOVA_PACKAGE_NAME} from ${CORDOVA_PACKAGE_SPEC} through "cordova plugin add".`;
    },
    wireBinaryCreateStep: () =>
      Promise.resolve({
        message:
          'The plugin wires its Xcode phase and Gradle task itself, so there is nothing to wire.',
        status: 'skipped',
        value: undefined,
      }),
  };
}
