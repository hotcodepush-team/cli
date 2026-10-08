import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CORDOVA_CONFIG_XML,
  writeCordovaProject,
} from '../../../test/cordova-project.js';
import { readPackageJson } from '../package-json.js';
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

  it('should take www as the build directory when config.xml names a start page in a directory of it', () => {
    const directoryPath = writeProjectWithWidget(
      'version="1.0.0"',
      '<content src="app/index.html" />',
    );

    expect(cordovaFramework.readBuildDirectory(directoryPath)).toBe('www');
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
    ).toEqual(['package:ok', 'hook:ok', 'android-file-mode:ok']);
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

  it("should fail the Android file mode when config.xml's Android section sets AndroidInsecureFileModeEnabled", () => {
    const directoryPath = writeProjectWithWidget(
      'version="2.4.1"',
      '<platform name="android"><preference name="AndroidInsecureFileModeEnabled" value="true" /></platform>',
    );

    expect(
      cordovaFramework.checkWiring({
        directoryPath,
        packageJson: readPackageJson(directoryPath),
      })[2],
    ).toEqual({
      check: 'android-file-mode',
      manualStep:
        'remove the preference; the plugin serves no update from file:// and stays off',
      message:
        'config.xml sets AndroidInsecureFileModeEnabled, which loads the Android app from file://',
      status: 'failed',
    });
  });

  it("should leave the Android file mode ok when config.xml's Android section turns off what the widget turns on", () => {
    const directoryPath = writeProjectWithWidget(
      'version="2.4.1"',
      '<preference name="AndroidInsecureFileModeEnabled" value="true" /><platform name="android"><preference name="androidinsecurefilemodeenabled" value="false" /></platform>',
    );

    expect(
      cordovaFramework.checkWiring({
        directoryPath,
        packageJson: readPackageJson(directoryPath),
      })[2]?.status,
    ).toBe('ok');
  });

  it('should install the plugin through cordova plugin add and leave binary create to the build steps it wires', async () => {
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
    expect(await wiring.wireBinaryCreateStep(undefined)).toEqual({
      message:
        'the plugin wires its Xcode phase and Gradle task itself; nothing to wire',
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
