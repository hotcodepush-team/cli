import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface ReactNativeProjectOptions {
  isPackageInstalled?: boolean;
  projectConfig?: object;
}

export const APP_DELEGATE_FILE_PATH = join('ios', 'Demo', 'AppDelegate.swift');

export const APP_GRADLE_FILE_PATH = join('android', 'app', 'build.gradle');

export const JAVA_MAIN_APPLICATION_FILE_PATH = join(
  'android',
  'app',
  'src',
  'main',
  'java',
  'com',
  'example',
  'demo',
  'MainApplication.java',
);

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

export const OBJECTIVE_C_APP_DELEGATE_FILE_PATH = join(
  'ios',
  'Demo',
  'AppDelegate.mm',
);

export const SCENE_DELEGATE_FILE_PATH = join(
  'ios',
  'Demo',
  'SceneDelegate.swift',
);

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

const APP_DELEGATE_STUB = `import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    true
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

const JAVA_MAIN_APPLICATION = `package com.example.demo;

import android.app.Application;
import com.facebook.react.PackageList;
import com.facebook.react.ReactApplication;
import com.facebook.react.ReactHost;
import com.facebook.react.defaults.DefaultReactHost;

public class MainApplication extends Application implements ReactApplication {
  @Override
  public ReactHost getReactHost() {
    return DefaultReactHost.getDefaultReactHost(getApplicationContext(), new PackageList(this).getPackages());
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

const OBJECTIVE_C_APP_DELEGATE = `#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>

@implementation AppDelegate

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
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

const SCENE_DELEGATE = `import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UIKit

class SceneDelegate: RCTDefaultReactNativeFactoryDelegate, UIWindowSceneDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }

    dependencyProvider = RCTAppDependencyProvider()
    reactNativeFactory = RCTReactNativeFactory(delegate: self)
    window = UIWindow(windowScene: windowScene)
    reactNativeFactory?.startReactNative(
      withModuleName: "Demo",
      in: window,
      connectionOptions: connectionOptions
    )
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
  writeFile(join(directoryPath, 'ios', 'Podfile'), PODFILE);
  writeFile(
    join(directoryPath, XCODE_PROJECT_FILE_PATH),
    readFileSync(PBXPROJ_FIXTURE_PATH, 'utf8'),
  );
  return directoryPath;
}

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
      name: '@hotcodepush/react-native-code-push',
      version: '0.1.0',
    },
  );
}

// React Native 0.88's template overrides `bundleURL()` in `SceneDelegate.swift`.
export function writeSceneDelegateLayout(directoryPath: string): void {
  writeFile(join(directoryPath, APP_DELEGATE_FILE_PATH), APP_DELEGATE_STUB);
  writeFile(join(directoryPath, SCENE_DELEGATE_FILE_PATH), SCENE_DELEGATE);
}

// Templates before React Native 0.77 and 0.73 had these files.
export function writeObjectiveCAndJavaLayout(directoryPath: string): void {
  rmSync(join(directoryPath, APP_DELEGATE_FILE_PATH));
  rmSync(join(directoryPath, MAIN_APPLICATION_FILE_PATH));
  writeFile(
    join(directoryPath, OBJECTIVE_C_APP_DELEGATE_FILE_PATH),
    OBJECTIVE_C_APP_DELEGATE,
  );
  writeFile(
    join(directoryPath, JAVA_MAIN_APPLICATION_FILE_PATH),
    JAVA_MAIN_APPLICATION,
  );
}

// Follows the manual steps `init` prints for these files.
export function wireObjectiveCAndJavaByHand(directoryPath: string): void {
  const appDelegatePath = join(
    directoryPath,
    OBJECTIVE_C_APP_DELEGATE_FILE_PATH,
  );
  writeFile(
    appDelegatePath,
    readFileSync(appDelegatePath, 'utf8')
      .replace(
        '#import <React/RCTBundleURLProvider.h>',
        '#import <React/RCTBundleURLProvider.h>\n#import <HotcodepushReactNativeCodePush/HotcodepushReactNativeCodePush-Swift.h>',
      )
      .replace(
        '[[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"]',
        '[HotCodePush bundleURL]',
      ),
  );
  const mainApplicationPath = join(
    directoryPath,
    JAVA_MAIN_APPLICATION_FILE_PATH,
  );
  writeFile(
    mainApplicationPath,
    readFileSync(mainApplicationPath, 'utf8')
      .replace(
        'import com.facebook.react.defaults.DefaultReactHost;',
        'import com.hotcodepush.reactnative.HotCodePushReactHost;',
      )
      .replace(
        'DefaultReactHost.getDefaultReactHost(',
        'HotCodePushReactHost.getDefaultReactHost(',
      ),
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
