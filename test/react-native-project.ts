import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * What a React Native project starts with in a test: the SDK when installed, and the project's configuration.
 */
export interface ReactNativeProjectOptions {
  isPackageInstalled?: boolean;
  projectConfig?: object;
}

export const APP_DELEGATE_FILE_PATH = join('ios', 'Demo', 'AppDelegate.swift');

export const APP_GRADLE_FILE_PATH = join('android', 'app', 'build.gradle');

export const MAIN_APPLICATION_FILE_PATH = join(
  'android',
  'app',
  'src',
  'main',
  'java',
  'com',
  'example',
  'demo',
  'MainApplication.kt',
);

export const PODFILE_PATH = join('ios', 'Podfile');

export const PROTOCOL_POD_COMMIT = '0123456789abcdef0123456789abcdef01234567';

export const XCODE_PROJECT_FILE_PATH = join(
  'ios',
  'Demo.xcodeproj',
  'project.pbxproj',
);

const APP_DELEGATE = `import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
`;

const APP_GRADLE = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

android {
    namespace "com.example.demo"
    defaultConfig {
        applicationId "com.example.demo"
        versionCode 57
        versionName "2.4.1"
    }
}
`;

const MAIN_APPLICATION = `package com.example.demo

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(context = applicationContext, packageList = PackageList(this).packages)
  }
}
`;

const PBXPROJ_FIXTURE_PATH = join(
  import.meta.dirname,
  'react-native-project.pbxproj',
);

const PODFILE = `platform :ios, min_ios_version_supported
prepare_react_native_project!

target 'Demo' do
  config = use_native_modules!

  use_react_native!(
    :path => config[:reactNativePath],
    :app_path => "#{Pod::Config.instance.installation_root}/.."
  )
end
`;

/**
 * A React Native project in a temporary directory as the template lays it out: `package.json`, the entry file,
 * the iOS project with its `AppDelegate.swift` and Podfile, the Android project with its Gradle file and
 * `MainApplication.kt`, nothing of the SDK wired; the caller removes it.
 */
export function writeReactNativeProject({
  isPackageInstalled = false,
  projectConfig,
}: ReactNativeProjectOptions = {}): string {
  const directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-project-'));
  writeJson(join(directoryPath, 'package.json'), {
    dependencies: {
      'react': '19.1.1',
      'react-native': '0.82.1',
      ...(isPackageInstalled
        ? { '@hotcodepush/react-native-code-push': '0.1.0' }
        : {}),
    },
    name: 'demo',
    version: '1.4.2',
  });
  if (projectConfig !== undefined) {
    writeJson(join(directoryPath, 'hotcodepush.json'), projectConfig);
  }
  writeFile(join(directoryPath, 'index.js'), '// the entry file\n');
  writeFile(join(directoryPath, APP_DELEGATE_FILE_PATH), APP_DELEGATE);
  writeFile(join(directoryPath, APP_GRADLE_FILE_PATH), APP_GRADLE);
  writeFile(join(directoryPath, MAIN_APPLICATION_FILE_PATH), MAIN_APPLICATION);
  writeFile(join(directoryPath, PODFILE_PATH), PODFILE);
  writeFile(
    join(directoryPath, XCODE_PROJECT_FILE_PATH),
    readFileSync(PBXPROJ_FIXTURE_PATH, 'utf8'),
  );
  return directoryPath;
}

/**
 * The SDK as `node_modules` holds it after the install, naming the commit of the pod the Podfile pins.
 */
export function writeInstalledSdk(directoryPath: string): void {
  writeJson(
    join(
      directoryPath,
      'node_modules',
      '@hotcodepush',
      'react-native-code-push',
      'package.json',
    ),
    {
      hotcodepush: { protocolIos: PROTOCOL_POD_COMMIT },
      name: '@hotcodepush/react-native-code-push',
      version: '0.1.0',
    },
  );
}

export function readProjectFile(
  directoryPath: string,
  filePath: string,
): string {
  return readFileSync(join(directoryPath, filePath), 'utf8');
}

function writeFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function writeJson(filePath: string, value: object): void {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
