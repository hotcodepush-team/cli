import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_DELEGATE_FILE_PATH,
  APP_GRADLE_FILE_PATH,
  MAIN_APPLICATION_FILE_PATH,
  PODFILE_PATH,
  PROTOCOL_POD_COMMIT,
  readProjectFile,
  writeInstalledSdk,
  writeReactNativeProject,
} from '../../test/react-native-project.js';
import { NativeProjectError } from './errors.js';
import {
  resolveBundleUrlEdit,
  resolveGradleEdit,
  resolveProtocolPodEdit,
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

    it('should answer no edit when the iOS project has no AppDelegate.swift', () => {
      rmSync(join(directoryPath, APP_DELEGATE_FILE_PATH));

      expect(resolveBundleUrlEdit(join(directoryPath, 'ios'))).toBeUndefined();
    });
  });

  describe('resolveGradleEdit', () => {
    it("should append the one apply from line that resolves the SDK's Gradle file through Node", () => {
      const edit = resolveGradleEdit(join(directoryPath, 'android'));
      expect(edit?.isApplied()).toBe(false);

      edit?.apply();

      expect(edit?.isApplied()).toBe(true);
      expect(
        readProjectFile(directoryPath, APP_GRADLE_FILE_PATH).split('\n').at(-2),
      ).toBe(
        `apply from: new File(["node", "--print", "require.resolve('@hotcodepush/react-native-code-push/package.json')"].execute(null, rootDir).text.trim(), "../android/hotcodepush.gradle")`,
      );
    });

    it('should write the line in Kotlin syntax when the file is build.gradle.kts', () => {
      rmSync(join(directoryPath, APP_GRADLE_FILE_PATH));
      const ktsFilePath = join(directoryPath, `${APP_GRADLE_FILE_PATH}.kts`);
      writeFileSync(ktsFilePath, 'plugins { id("com.android.application") }');

      resolveGradleEdit(join(directoryPath, 'android'))?.apply();

      expect(
        readProjectFile(directoryPath, `${APP_GRADLE_FILE_PATH}.kts`)
          .split('\n')
          .at(-2),
      ).toBe(
        `apply(from = File(providers.exec { workingDir(rootDir); commandLine("node", "--print", "require.resolve('@hotcodepush/react-native-code-push/package.json')") }.standardOutput.asText.get().trim()).resolveSibling("android/hotcodepush.gradle"))`,
      );
    });
  });

  describe('resolveProtocolPodEdit', () => {
    it('should pin the pod at the commit the installed SDK names, after use_native_modules!', () => {
      writeInstalledSdk(directoryPath);
      const edit = resolveProtocolPodEdit(
        join(directoryPath, 'ios'),
        directoryPath,
      );
      expect(edit?.isApplied()).toBe(false);

      edit?.apply();

      expect(edit?.isApplied()).toBe(true);
      expect(readProjectFile(directoryPath, PODFILE_PATH)).toContain(
        `  config = use_native_modules!\n  pod 'HotCodePushProtocol', :git => 'https://github.com/hotcodepush-team/protocol-ios.git', :commit => '${PROTOCOL_POD_COMMIT}'\n`,
      );
    });

    it('should pin the pod when the Podfile names it outside a pod line', () => {
      writeInstalledSdk(directoryPath);
      const filePath = join(directoryPath, PODFILE_PATH);
      writeFileSync(
        filePath,
        `${readProjectFile(directoryPath, PODFILE_PATH)}\npost_install do |installer|\n  # HotCodePushProtocol's resource bundle\nend\n`,
      );
      const edit = resolveProtocolPodEdit(
        join(directoryPath, 'ios'),
        directoryPath,
      );
      expect(edit?.isApplied()).toBe(false);

      edit?.apply();

      expect(readProjectFile(directoryPath, PODFILE_PATH)).toContain(
        "  config = use_native_modules!\n  pod 'HotCodePushProtocol', :git =>",
      );
    });

    it('should stop with the manual step when the SDK is not installed yet', () => {
      expect(() =>
        resolveProtocolPodEdit(
          join(directoryPath, 'ios'),
          directoryPath,
        )?.apply(),
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
