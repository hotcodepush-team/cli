import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PBXPROJ_FIXTURE_PATH } from '../../test/capacitor-project.js';
import {
  XCODE_PROJECT_FILE_PATH,
  writeReactNativeProject,
} from '../../test/react-native-project.js';
import { XcodeProjectError } from './errors.js';
import {
  addBinaryCreatePhase,
  addResourceReference,
  hasBinaryCreatePhase,
  hasResourceReference,
  resolveXcodeProjectFilePath,
} from './xcode-project.js';

describe('xcode-project', () => {
  let directoryPath = '';
  let projectFilePath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-xcode-'));
    projectFilePath = join(directoryPath, 'project.pbxproj');
    copyFileSync(PBXPROJ_FIXTURE_PATH, projectFilePath);
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  it('should add hotcodepush.json to the app target resources in the App group once, and see it afterwards', async () => {
    expect(hasResourceReference(projectFilePath)).toBe(false);

    expect(await addResourceReference(projectFilePath, {})).toBe('added');

    expect(hasResourceReference(projectFilePath)).toBe(true);
    const projectText = readFileSync(projectFilePath, 'utf8');
    expect(projectText).toMatch(
      /hotcodepush\.json \*\/ = \{isa = PBXFileReference; name = "hotcodepush\.json"; path = "hotcodepush\.json"; sourceTree = "<group>"; fileEncoding = 4; lastKnownFileType = text\.json; includeInIndex = 0; \};/,
    );
    expect(projectText).toMatch(
      /hotcodepush\.json in Resources \*\/ = \{isa = PBXBuildFile;/,
    );
    expect(projectText).not.toContain('undefined');
    expect(await addResourceReference(projectFilePath, {})).toBe('present');
  });

  it('should find the project of cap add ios under App/App.xcodeproj', () => {
    const iosPath = join(directoryPath, 'ios');
    expect(resolveXcodeProjectFilePath(iosPath)).toBeUndefined();

    const capacitorProjectPath = join(iosPath, 'App', 'App.xcodeproj');
    mkdirSync(capacitorProjectPath, { recursive: true });
    copyFileSync(
      PBXPROJ_FIXTURE_PATH,
      join(capacitorProjectPath, 'project.pbxproj'),
    );

    expect(resolveXcodeProjectFilePath(iosPath)).toBe(
      join(capacitorProjectPath, 'project.pbxproj'),
    );
  });

  it('should refuse an --xcode-target that names no app target, listing the targets', async () => {
    await expect(
      addResourceReference(projectFilePath, { xcodeTarget: 'Widget' }),
    ).rejects.toMatchObject({
      code: 'E_INVALID_PARAMETER',
      message:
        '--xcode-target: no app target is named Widget; the targets are App',
    });
  });

  it('should answer E_XCODE_PROJECT with the manual step when the project cannot be parsed', () => {
    writeFileSync(projectFilePath, 'not a project');

    expect(() => hasResourceReference(projectFilePath)).toThrow(
      XcodeProjectError,
    );
  });

  describe('the binary create phase of a React Native project', () => {
    let reactNativeDirectoryPath = '';
    let reactNativeProjectFilePath = '';

    beforeEach(() => {
      reactNativeDirectoryPath = writeReactNativeProject();
      reactNativeProjectFilePath = join(
        reactNativeDirectoryPath,
        XCODE_PROJECT_FILE_PATH,
      );
    });

    afterEach(() => {
      rmSync(reactNativeDirectoryPath, { force: true, recursive: true });
    });

    it('should add the phase right after the bundling phase once, running the SDK package script through with-environment.sh', async () => {
      expect(hasBinaryCreatePhase(reactNativeProjectFilePath)).toBe(false);

      expect(await addBinaryCreatePhase(reactNativeProjectFilePath, {})).toBe(
        'added',
      );

      expect(hasBinaryCreatePhase(reactNativeProjectFilePath)).toBe(true);
      const projectText = readFileSync(reactNativeProjectFilePath, 'utf8');
      expect(projectText).toMatch(
        /\/\* Bundle React Native code and images \*\/,\n\t+[0-9A-F]+ \/\* Create HotCodePush binary \*\/,/,
      );
      expect(projectText).toContain(
        'shellScript = "set -e\\n\\n# hotcodepush: writes hotcodepush.json into the app and registers the binary\\nWITH_ENVIRONMENT=\\"$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh\\"\\nHOTCODEPUSH_BINARY_CREATE=\\"$REACT_NATIVE_PATH/../@hotcodepush/react-native-code-push/scripts/binary-create-xcode.sh\\"\\n\\n/bin/sh -c \\"$WITH_ENVIRONMENT $HOTCODEPUSH_BINARY_CREATE\\"\\n";',
      );
      expect(await addBinaryCreatePhase(reactNativeProjectFilePath, {})).toBe(
        'present',
      );
    });

    it('should mark the phase to run on every build, since the resource file carries the build time', async () => {
      await addBinaryCreatePhase(reactNativeProjectFilePath, {});

      expect(readFileSync(reactNativeProjectFilePath, 'utf8')).toMatch(
        /\/\* Create HotCodePush binary \*\/ = \{[^}]*\balwaysOutOfDate = 1;/,
      );
    });

    it("should declare the processed Info.plist as the phase's input, since the script reads the version and build from it", async () => {
      await addBinaryCreatePhase(reactNativeProjectFilePath, {});

      expect(readFileSync(reactNativeProjectFilePath, 'utf8')).toMatch(
        /\/\* Create HotCodePush binary \*\/ = \{[^}]*\binputPaths = \(\n\t+"\$\(TARGET_BUILD_DIR\)\/\$\(INFOPLIST_PATH\)",\n\t+\);/,
      );
    });

    it('should stop with the manual step when the project has no bundling phase to run after', async () => {
      await expect(
        addBinaryCreatePhase(projectFilePath, {}),
      ).rejects.toMatchObject({
        code: 'E_XCODE_PROJECT',
        fix: expect.stringContaining('binary-create-xcode.sh'),
        message: `${projectFilePath} has no "Bundle React Native code and images" phase to run binary create after`,
      });
      expect(hasBinaryCreatePhase(projectFilePath)).toBe(false);
    });
  });
});
