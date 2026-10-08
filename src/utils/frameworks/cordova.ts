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
  NativeProjectPaths,
} from './index.js';

/**
 * A `<platform>` section of `config.xml` and the preferences it sets for that platform alone.
 */
interface PlatformSection {
  name?: string;
  preference?: Preference[];
}

interface Preference {
  name?: string;
  value?: string;
}

/**
 * The `<widget>` of `config.xml` as the CLI reads it: the preferences, the widget's and each platform's.
 */
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

/**
 * Cordova: the web build at `www`, the native projects under `platforms/`, and the build step inside the native build,
 * an Xcode phase and a Gradle task the plugin wires itself, which write the resource file into the app they build.
 */
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
  // the start page `config.xml` names is a page inside `www`, which the app serves as its root
  readBuildDirectory: () => ({ path: WEB_DIRECTORY }),
  resolveNativeProjectPaths,
  resolveWiring: project => Promise.resolve(resolveWiring(project)),
};

/**
 * The build steps are the plugin's: it wires them into each platform it is added to once `package.json` lists it among Cordova's.
 */
function checkHook({ packageJson }: FrameworkProject): FrameworkCheck {
  return isPluginListed(packageJson)
    ? {
        check: 'hook',
        message: "the plugin's Xcode phase and Gradle task run the build step",
        status: 'ok',
      }
    : {
        check: 'hook',
        manualStep: `run ${resolveCommandLineText(PLUGIN_ADD_COMMAND_LINE)}`,
        message: `${CORDOVA_PACKAGE_NAME} is not among package.json's cordova plugins`,
        status: 'failed',
      };
}

/**
 * Under `AndroidInsecureFileModeEnabled` the Android app loads from `file://`, where the plugin serves no update and stays off.
 */
function checkInsecureFileMode({
  directoryPath,
}: FrameworkProject): FrameworkCheck {
  return isInsecureFileModeEnabled(readWidget(directoryPath))
    ? {
        check: 'android-file-mode',
        manualStep:
          'remove the preference; the plugin serves no update from file:// and stays off',
        message: `${CONFIG_FILE_NAME} sets ${INSECURE_FILE_MODE_PREFERENCE_NAME}, which loads the Android app from file://`,
        status: 'failed',
      }
    : {
        check: 'android-file-mode',
        message: `${CONFIG_FILE_NAME} leaves ${INSECURE_FILE_MODE_PREFERENCE_NAME} off`,
        status: 'ok',
      };
}

/**
 * The preference as Cordova's Android preferences read it: the name in any case, the Android section's value over
 * the widget's and the later over the earlier, `true` in any case.
 */
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

function resolveNativeProjectPaths(
  projectDirectoryPath: string,
): NativeProjectPaths {
  return {
    android: join(projectDirectoryPath, 'platforms', 'android'),
    ios: join(projectDirectoryPath, 'platforms', 'ios'),
  };
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
      return `installed ${CORDOVA_PACKAGE_NAME} from ${CORDOVA_PACKAGE_SPEC} through cordova plugin add`;
    },
    wireBinaryCreateStep: () =>
      Promise.resolve({
        message:
          'the plugin wires its Xcode phase and Gradle task itself; nothing to wire',
        status: 'skipped',
        value: undefined,
      }),
  };
}
