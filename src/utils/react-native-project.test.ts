import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_DELEGATE_FILE_PATH,
  CORE_POD_COMMIT,
  MAIN_APPLICATION_FILE_PATH,
  PODFILE_PATH,
  SCENE_DELEGATE_FILE_PATH,
  readProjectFile,
  writeInstalledSdk,
  writeReactNativeProject,
  writeSceneDelegateLayout,
} from '../../test/react-native-project.js';
import { NativeProjectError } from './errors.js';
import {
  resolveBundleUrlEdit,
  resolveCorePodEdit,
  resolveReactHostEdit,
} from './react-native-project.js';

describe('react-native-project', () => {
  let directoryPath = '';

  beforeEach(() => {
    directoryPath = writeReactNativeProject();
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  describe('resolveBundleUrlEdit', () => {
    it("should return HotCodePush.bundleURL() in place of the template's main.jsbundle, import the module and keep the debug line", () => {
      const edit = resolveBundleUrlEdit(join(directoryPath, 'ios'));
      expect(edit?.isApplied()).toBe(false);

      edit?.apply();

      const appDelegate = readProjectFile(
        directoryPath,
        APP_DELEGATE_FILE_PATH,
      );
      expect(edit?.isApplied()).toBe(true);
      expect(appDelegate).toContain(
        'import ReactAppDependencyProvider\nimport HotcodepushReactNativeCodePush\n',
      );
      expect(appDelegate).toContain(
        '#else\n    HotCodePush.bundleURL()\n#endif',
      );
      expect(appDelegate).toContain(
        'RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")',
      );
      expect(appDelegate).not.toContain('Bundle.main.url');
    });

    it("should return HotCodePush.bundleURL() from SceneDelegate.swift and leave AppDelegate.swift alone when the project has React Native 0.88's layout", () => {
      writeSceneDelegateLayout(directoryPath);
      const appDelegate = readProjectFile(
        directoryPath,
        APP_DELEGATE_FILE_PATH,
      );
      const edit = resolveBundleUrlEdit(join(directoryPath, 'ios'));
      expect(edit?.description).toBe(
        'HotCodePush.bundleURL() in SceneDelegate.swift',
      );
      expect(edit?.filePath).toBe(
        join(directoryPath, SCENE_DELEGATE_FILE_PATH),
      );

      edit?.apply();

      const sceneDelegate = readProjectFile(
        directoryPath,
        SCENE_DELEGATE_FILE_PATH,
      );
      expect(edit?.isApplied()).toBe(true);
      expect(sceneDelegate).toContain(
        'import UIKit\nimport HotcodepushReactNativeCodePush\n',
      );
      expect(sceneDelegate).toContain(
        '#else\n    HotCodePush.bundleURL()\n    #endif',
      );
      expect(sceneDelegate).not.toContain('Bundle.main.url');
      expect(readProjectFile(directoryPath, APP_DELEGATE_FILE_PATH)).toBe(
        appDelegate,
      );
    });

    it('should stop with the manual step when bundleURL() does not return the template line', () => {
      const filePath = join(directoryPath, APP_DELEGATE_FILE_PATH);
      writeFileSync(
        filePath,
        'import UIKit\n\nfunc bundleURL() -> URL? { customBundleURL() }\n',
      );

      expect(() =>
        resolveBundleUrlEdit(join(directoryPath, 'ios'))?.apply(),
      ).toThrow(NativeProjectError);
    });

    it('should stop with the manual step naming both files when neither SceneDelegate.swift nor AppDelegate.swift overrides bundleURL()', () => {
      writeSceneDelegateLayout(directoryPath);
      writeFileSync(
        join(directoryPath, SCENE_DELEGATE_FILE_PATH),
        'import UIKit\n\nclass SceneDelegate: UIResponder, UIWindowSceneDelegate {}\n',
      );

      expect(() =>
        resolveBundleUrlEdit(join(directoryPath, 'ios'))?.apply(),
      ).toThrow(
        new NativeProjectError(
          `Neither ${join(directoryPath, SCENE_DELEGATE_FILE_PATH)} nor ${join(directoryPath, APP_DELEGATE_FILE_PATH)} returns the template's main.jsbundle from bundleURL().`,
          'Import HotcodepushReactNativeCodePush in the file that overrides bundleURL() and return HotCodePush.bundleURL() from it where it returns the embedded bundle.',
        ),
      );
    });

    it('should answer no edit when the iOS project has no AppDelegate.swift', () => {
      rmSync(join(directoryPath, APP_DELEGATE_FILE_PATH));

      expect(resolveBundleUrlEdit(join(directoryPath, 'ios'))).toBeUndefined();
    });
  });

  describe('resolveCorePodEdit', () => {
    it('should pin the pod at the commit the installed SDK names, after use_native_modules!', () => {
      writeInstalledSdk(directoryPath);
      const edit = resolveCorePodEdit(
        join(directoryPath, 'ios'),
        directoryPath,
      );
      expect(edit?.isApplied()).toBe(false);

      edit?.apply();

      expect(edit?.isApplied()).toBe(true);
      expect(readProjectFile(directoryPath, PODFILE_PATH)).toContain(
        `  config = use_native_modules!\n  pod 'HotCodePushCore', :git => 'https://github.com/hotcodepush-team/core-ios.git', :commit => '${CORE_POD_COMMIT}'\n`,
      );
    });

    it('should pin the pod when the Podfile names it outside a pod line', () => {
      writeInstalledSdk(directoryPath);
      const filePath = join(directoryPath, PODFILE_PATH);
      writeFileSync(
        filePath,
        `${readProjectFile(directoryPath, PODFILE_PATH)}\npost_install do |installer|\n  # HotCodePushCore's resource bundle\nend\n`,
      );
      const edit = resolveCorePodEdit(
        join(directoryPath, 'ios'),
        directoryPath,
      );
      expect(edit?.isApplied()).toBe(false);

      edit?.apply();

      expect(readProjectFile(directoryPath, PODFILE_PATH)).toContain(
        "  config = use_native_modules!\n  pod 'HotCodePushCore', :git =>",
      );
    });

    it('should stop with the manual step when the SDK is not installed yet', () => {
      expect(() =>
        resolveCorePodEdit(join(directoryPath, 'ios'), directoryPath)?.apply(),
      ).toThrow(NativeProjectError);
    });
  });

  describe('resolveReactHostEdit', () => {
    it("should import the SDK's getDefaultReactHost in place of React Native's and leave the call alone", () => {
      const edit = resolveReactHostEdit(join(directoryPath, 'android'));
      expect(edit?.isApplied()).toBe(false);

      edit?.apply();

      const mainApplication = readProjectFile(
        directoryPath,
        MAIN_APPLICATION_FILE_PATH,
      );
      expect(edit?.isApplied()).toBe(true);
      expect(mainApplication).toContain(
        'import com.hotcodepush.reactnative.HotCodePushReactHost.getDefaultReactHost\n',
      );
      expect(mainApplication).not.toContain(
        'DefaultReactHost.getDefaultReactHost',
      );
      expect(mainApplication).toContain(
        'getDefaultReactHost(context = applicationContext,',
      );
    });

    it("should stop with the manual step when the file does not import the template's host", () => {
      writeFileSync(
        join(directoryPath, MAIN_APPLICATION_FILE_PATH),
        'package com.example.demo\n\nclass MainApplication\n',
      );

      expect(() =>
        resolveReactHostEdit(join(directoryPath, 'android'))?.apply(),
      ).toThrow(NativeProjectError);
    });
  });
});
