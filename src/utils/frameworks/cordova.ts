import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import {
  CORDOVA_PACKAGE_NAME,
  CORDOVA_PACKAGE_SPEC,
} from '../../config/consts.js';
import type { BinaryIdentity } from '../binary-identity.js';
import { InvalidParameterError } from '../errors.js';
import type { CommandLine } from '../package-manager.js';
import {
  resolveCommandLineText,
  runCommandLineVisibly,
} from '../package-manager.js';
import type { Platform } from '../upload.js';
import { checkSdkPackage, isSdkPackageDeclared } from './sdk-package.js';
import type {
  FrameworkCheck,
  FrameworkModule,
  FrameworkProject,
  FrameworkWiring,
  NativeProjectPaths,
} from './index.js';

/**
 * The `<widget>` of `config.xml` as the CLI reads it: the version, the per-platform build numbers and the start page.
 */
interface Widget {
  'android-versionCode'?: string;
  'content'?: { src?: string } | { src?: string }[];
  'ios-CFBundleVersion'?: string;
  'version'?: string;
}

const CONFIG_FILE_NAME = 'config.xml';

const PLUGIN_ADD_COMMAND_LINE: CommandLine = {
  args: ['cordova', 'plugin', 'add', CORDOVA_PACKAGE_SPEC],
  command: 'npx',
};

const RELATIVE_PATH_PATTERN = /^(?![a-z][a-z0-9+.-]*:)[^/]/i;

const WEB_DIRECTORY = 'www';

/**
 * Cordova: the web build at `www`, the native projects under `platforms/`, the store build's identity in `config.xml`,
 * and the embed step as the plugin's own `after_prepare` hook, which writes the resource file into each platform's `www`.
 */
export const cordovaFramework: FrameworkModule = {
  embedStep: 'run npx cordova prepare, which runs the embed hook',
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
  ],
  readBinaryIdentity,
  readBuildDirectory,
  resolveNativeProjectPaths,
  resolveResourceFilePath,
  resolveWiring: project => Promise.resolve(resolveWiring(project)),
};

/**
 * The hook is the plugin's: it runs on every prepare once `package.json` lists the plugin among Cordova's.
 */
function checkHook({ packageJson }: FrameworkProject): FrameworkCheck {
  return isPluginListed(packageJson)
    ? {
        check: 'hook',
        message: "the plugin's after_prepare hook runs the embed step",
        status: 'ok',
      }
    : {
        check: 'hook',
        manualStep: `run ${resolveCommandLineText(PLUGIN_ADD_COMMAND_LINE)}`,
        message: `${CORDOVA_PACKAGE_NAME} is not among package.json's cordova plugins`,
        status: 'failed',
      };
}

function isPluginListed(packageJson: FrameworkProject['packageJson']): boolean {
  return packageJson?.cordova?.plugins?.[CORDOVA_PACKAGE_NAME] !== undefined;
}

/**
 * The identity Cordova gives the store build at prepare: the widget's version on both platforms, `ios-CFBundleVersion`
 * or the version without its pre-release label on iOS, `android-versionCode` or the code Cordova computes from the version on Android.
 */
function readBinaryIdentity(
  platform: Platform,
  projectDirectoryPath: string,
): BinaryIdentity {
  const configFilePath = join(projectDirectoryPath, CONFIG_FILE_NAME);
  const widget = readWidget(projectDirectoryPath);
  if (widget === undefined) {
    throw new InvalidParameterError(
      `--binary-version: no ${CONFIG_FILE_NAME} at ${projectDirectoryPath} to read it from`,
      undefined,
    );
  }
  const { version } = widget;
  if (version === undefined) {
    throw new InvalidParameterError(
      `--binary-version: version is missing from ${configFilePath}`,
      undefined,
    );
  }
  return {
    binaryBuild:
      platform === 'ios'
        ? (widget['ios-CFBundleVersion'] ?? resolveReleaseVersion(version))
        : (widget['android-versionCode'] ?? resolveVersionCode(version)),
    binaryVersion: version,
  };
}

/**
 * The directory of `config.xml`'s start page under `www`, or `www` itself when the page lies at its root or elsewhere.
 */
function readBuildDirectory(projectDirectoryPath: string): string {
  const content = readWidget(projectDirectoryPath)?.content;
  const startPage = Array.isArray(content) ? content[0]?.src : content?.src;
  return startPage !== undefined && RELATIVE_PATH_PATTERN.test(startPage)
    ? posix.join(WEB_DIRECTORY, dirname(startPage))
    : WEB_DIRECTORY;
}

function readWidget(projectDirectoryPath: string): Widget | undefined {
  const configFilePath = join(projectDirectoryPath, CONFIG_FILE_NAME);
  if (!existsSync(configFilePath)) {
    return undefined;
  }
  const document = new XMLParser({
    attributeNamePrefix: '',
    ignoreAttributes: false,
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

/**
 * The version without its pre-release label, Cordova's `CFBundleVersion` when `config.xml` names none.
 */
function resolveReleaseVersion(version: string): string {
  return version.split('-')[0] ?? version;
}

/**
 * Beside the web assets Cordova copies into each platform, which both platforms bundle as `www`.
 */
function resolveResourceFilePath(
  platform: Platform,
  nativeProjectPath: string,
): string {
  return platform === 'ios'
    ? join(nativeProjectPath, WEB_DIRECTORY, 'hotcodepush.json')
    : join(
        nativeProjectPath,
        'app',
        'src',
        'main',
        'assets',
        WEB_DIRECTORY,
        'hotcodepush.json',
      );
}

/**
 * Cordova's `versionCode` when `config.xml` names none: major, minor and patch as two digits each.
 */
function resolveVersionCode(version: string): string {
  const [major, minor, patch] = resolveReleaseVersion(version)
    .split('.')
    .map(part => Number(part) || 0);
  return String((major ?? 0) * 10000 + (minor ?? 0) * 100 + (patch ?? 0));
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
    wireEmbedStep: () =>
      Promise.resolve({
        message: 'the plugin brings its after_prepare hook; nothing to wire',
        status: 'skipped',
        value: undefined,
      }),
  };
}
