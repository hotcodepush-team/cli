import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CORDOVA_CONFIG_XML,
  writeCordovaProject,
} from '../../../test/cordova-project.js';
import { readPackageJson } from '../embed-hook.js';
import { InvalidParameterError } from '../errors.js';
import type * as packageManagerModule from '../package-manager.js';
import { runCommandLineVisibly } from '../package-manager.js';
import { cordovaFramework } from './cordova.js';

vi.mock('../package-manager.js', async importOriginal => ({
  ...(await importOriginal<typeof packageManagerModule>()),
  runCommandLineVisibly: vi.fn(),
}));

describe('cordova', () => {
  const directoryPaths: string[] = [];

  function writeProject(
    options: Parameters<typeof writeCordovaProject>[0] = {},
  ): string {
    const directoryPath = writeCordovaProject(options);
    directoryPaths.push(directoryPath);
    return directoryPath;
  }

  function writeProjectWithWidget(attributes: string, content = ''): string {
    return writeProject({
      configXml: `<widget ${attributes}>${content}</widget>`,
    });
  }

  afterEach(() => {
    for (const directoryPath of directoryPaths.splice(0)) {
      rmSync(directoryPath, { force: true, recursive: true });
    }
  });

  it('should take www as the build directory when the start page lies at its root', () => {
    expect(cordovaFramework.readBuildDirectory(writeProject())).toBe('www');
  });

  it('should take the directory of the start page under www when config.xml names one', () => {
    const directoryPath = writeProjectWithWidget(
      'version="1.0.0"',
      '<content src="app/index.html" />',
    );

    expect(cordovaFramework.readBuildDirectory(directoryPath)).toBe('www/app');
  });

  it('should take www when the start page is a URL', () => {
    const directoryPath = writeProjectWithWidget(
      'version="1.0.0"',
      '<content src="https://example.com/index.html" />',
    );

    expect(cordovaFramework.readBuildDirectory(directoryPath)).toBe('www');
  });

  it('should take www when the project has no config.xml', () => {
    const directoryPath = writeProject();
    rmSync(join(directoryPath, 'config.xml'));

    expect(cordovaFramework.readBuildDirectory(directoryPath)).toBe('www');
  });

  it("should read the store build's identity from the build numbers config.xml names", () => {
    const directoryPath = writeProjectWithWidget(
      'version="2.4.1" ios-CFBundleVersion="57" android-versionCode="20457"',
    );

    expect(cordovaFramework.readBinaryIdentity('ios', directoryPath)).toEqual({
      binaryBuild: '57',
      binaryVersion: '2.4.1',
    });
    expect(
      cordovaFramework.readBinaryIdentity('android', directoryPath),
    ).toEqual({ binaryBuild: '20457', binaryVersion: '2.4.1' });
  });

  it('should derive the build numbers as Cordova does when config.xml names none', () => {
    const directoryPath = writeProjectWithWidget('version="2.4.1-rc.1"');

    expect(cordovaFramework.readBinaryIdentity('ios', directoryPath)).toEqual({
      binaryBuild: '2.4.1',
      binaryVersion: '2.4.1-rc.1',
    });
    expect(
      cordovaFramework.readBinaryIdentity('android', directoryPath),
    ).toEqual({ binaryBuild: '20401', binaryVersion: '2.4.1-rc.1' });
  });

  it('should name the flag to pass when config.xml is missing', () => {
    const directoryPath = writeProject();
    rmSync(join(directoryPath, 'config.xml'));

    expect(() =>
      cordovaFramework.readBinaryIdentity('ios', directoryPath),
    ).toThrow(InvalidParameterError);
  });

  it('should name the flag to pass when config.xml carries no version', () => {
    const directoryPath = writeProjectWithWidget('id="com.example.demo"');

    expect(() =>
      cordovaFramework.readBinaryIdentity('android', directoryPath),
    ).toThrow(/version is missing from .*config\.xml/);
  });

  it("should place the resource file beside each platform's web assets", () => {
    const directoryPath = writeProject();
    const nativeProjectPaths =
      cordovaFramework.resolveNativeProjectPaths(directoryPath);

    expect(
      cordovaFramework.resolveResourceFilePath('ios', nativeProjectPaths.ios),
    ).toBe(join(directoryPath, 'platforms/ios/www/hotcodepush.json'));
    expect(
      cordovaFramework.resolveResourceFilePath(
        'android',
        nativeProjectPaths.android,
      ),
    ).toBe(
      join(
        directoryPath,
        'platforms/android/app/src/main/assets/www/hotcodepush.json',
      ),
    );
  });

  it('should report the plugin and its hook ok when package.json lists the plugin among Cordova’s', () => {
    const directoryPath = writeProject({ isPluginInstalled: true });

    expect(
      cordovaFramework
        .checkWiring({
          directoryPath,
          packageJson: readPackageJson(directoryPath),
        })
        .map(({ check, status }) => `${check}:${status}`),
    ).toEqual(['package:ok', 'hook:ok']);
  });

  it('should fail the hook with the plugin add command when package.json does not list the plugin', () => {
    const directoryPath = writeProject();

    expect(
      cordovaFramework.checkWiring({
        directoryPath,
        packageJson: readPackageJson(directoryPath),
      })[1],
    ).toEqual({
      check: 'hook',
      manualStep: expect.stringMatching(
        /^run npx cordova plugin add https:\/\/pkg\.pr\.new\//,
      ) as string,
      message:
        "@hotcodepush/cordova-code-push is not among package.json's cordova plugins",
      status: 'failed',
    });
  });

  it('should install the plugin through cordova plugin add and leave binary create to its hook', async () => {
    const directoryPath = writeProject();
    const wiring = await cordovaFramework.resolveWiring(
      { directoryPath, packageJson: readPackageJson(directoryPath) },
      {},
    );

    expect(wiring.isPackageInstalled).toBe(false);
    expect(wiring.packageFilePaths).toEqual(['package.json']);
    expect(wiring.installPackage()).toMatch(/through cordova plugin add$/);
    expect(runCommandLineVisibly).toHaveBeenCalledWith(
      {
        args: [
          'cordova',
          'plugin',
          'add',
          expect.stringMatching(/@hotcodepush\/cordova-code-push@/) as string,
        ],
        command: 'npx',
      },
      directoryPath,
    );
    expect(await wiring.wireEmbedStep(undefined)).toEqual({
      message: 'the plugin brings its after_prepare hook; nothing to wire',
      status: 'skipped',
      value: undefined,
    });
  });

  it('should change nothing in a project that already lists the plugin', async () => {
    const directoryPath = writeProject({ isPluginInstalled: true });
    writeFileSync(join(directoryPath, 'config.xml'), CORDOVA_CONFIG_XML);

    const wiring = await cordovaFramework.resolveWiring(
      { directoryPath, packageJson: readPackageJson(directoryPath) },
      {},
    );

    expect(wiring.isPackageInstalled).toBe(true);
    expect(wiring.packageFilePaths).toEqual([]);
    expect(wiring.nativeFilePaths).toEqual([]);
  });
});
