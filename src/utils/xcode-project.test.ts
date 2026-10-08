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
import {
  CAPACITOR_XCODE_PROJECT_FILE_PATH,
  PBXPROJ_FIXTURE_PATH,
  writeCapacitorProject,
  writeResourceReference,
} from '../../test/capacitor-project.js';
import {
  XCODE_PROJECT_FILE_PATH,
  writeReactNativeProject,
} from '../../test/react-native-project.js';
import type { BinaryCreatePhase } from './xcode-project.js';
import {
  addBinaryCreatePhase,
  hasBinaryCreatePhase,
  hasReadableResourceReference,
  removeResourceReference,
  resolveXcodeProjectFilePath,
} from './xcode-project.js';

const APPENDED_PHASE: BinaryCreatePhase = {
  anchorPhaseName: undefined,
  fix: 'add the phase by hand.',
  shellScript: '/bin/sh scripts/binary-create-xcode.sh\\n',
};

const ANCHORED_PHASE: BinaryCreatePhase = {
  ...APPENDED_PHASE,
  anchorPhaseName: 'Bundle React Native code and images',
};

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

  it("should append the phase after the app target's last phase once when it follows no phase, and see it afterwards", async () => {
    expect(hasBinaryCreatePhase(projectFilePath)).toBe(false);

    expect(
      await addBinaryCreatePhase(projectFilePath, APPENDED_PHASE, {}),
    ).toBe('added');

    expect(hasBinaryCreatePhase(projectFilePath)).toBe(true);
    const projectText = readFileSync(projectFilePath, 'utf8');
    expect(projectText).toMatch(
      /\/\* Resources \*\/,\n\t+[0-9A-F]+ \/\* Create HotCodePush binary \*\/,\n\t+\);/,
    );
    expect(projectText).toContain(
      'shellScript = "/bin/sh scripts/binary-create-xcode.sh\\n";',
    );
    expect(
      await addBinaryCreatePhase(projectFilePath, APPENDED_PHASE, {}),
    ).toBe('present');
  });

  it('should keep every line of the project as it was, the numbers with leading zeros the package would rewrite included', async () => {
    const originalLines = readFileSync(projectFilePath, 'utf8').split('\n');

    await addBinaryCreatePhase(projectFilePath, APPENDED_PHASE, {});

    const projectText = readFileSync(projectFilePath, 'utf8');
    expect(projectText).toContain('LastSwiftUpdateCheck = 0920;');
    expect(projectText).toContain('LastUpgradeCheck = 0920;');
    expect(
      originalLines.filter(line => !projectText.split('\n').includes(line)),
    ).toEqual([]);
  });

  it('should mark the phase to run on every build, since the resource file carries the build time', async () => {
    await addBinaryCreatePhase(projectFilePath, APPENDED_PHASE, {});

    expect(readFileSync(projectFilePath, 'utf8')).toMatch(
      /\/\* Create HotCodePush binary \*\/ = \{[^}]*\balwaysOutOfDate = 1;/,
    );
  });

  it("should declare the processed Info.plist as the phase's input, since the script reads the version and build from it", async () => {
    await addBinaryCreatePhase(projectFilePath, APPENDED_PHASE, {});

    expect(readFileSync(projectFilePath, 'utf8')).toMatch(
      /\/\* Create HotCodePush binary \*\/ = \{[^}]*\binputPaths = \(\n\t+"\$\(TARGET_BUILD_DIR\)\/\$\(INFOPLIST_PATH\)",\n\t+\);/,
    );
  });

  it('should refuse an --xcode-target that names no app target, listing the targets', async () => {
    await expect(
      addBinaryCreatePhase(projectFilePath, APPENDED_PHASE, {
        xcodeTarget: 'Widget',
      }),
    ).rejects.toMatchObject({
      code: 'E_INVALID_PARAMETER',
      message:
        '--xcode-target: no app target is named Widget; the targets are App',
    });
  });

  it("should answer E_XCODE_PROJECT with the phase's manual step when the project cannot be parsed", async () => {
    writeFileSync(projectFilePath, 'not a project');

    await expect(
      addBinaryCreatePhase(projectFilePath, APPENDED_PHASE, {}),
    ).rejects.toMatchObject({
      code: 'E_XCODE_PROJECT',
      fix: APPENDED_PHASE.fix,
    });
  });

  it('should stop with the manual step when the project has no phase to run after', async () => {
    await expect(
      addBinaryCreatePhase(projectFilePath, ANCHORED_PHASE, {}),
    ).rejects.toMatchObject({
      code: 'E_XCODE_PROJECT',
      fix: ANCHORED_PHASE.fix,
      message: `${projectFilePath} has no "Bundle React Native code and images" phase to run the build step after`,
    });
    expect(hasBinaryCreatePhase(projectFilePath)).toBe(false);
  });

  describe('the hotcodepush.json reference an earlier init added', () => {
    let capacitorDirectoryPath = '';
    let capacitorProjectFilePath = '';

    beforeEach(() => {
      capacitorDirectoryPath = writeCapacitorProject();
      capacitorProjectFilePath = join(
        capacitorDirectoryPath,
        CAPACITOR_XCODE_PROJECT_FILE_PATH,
      );
      writeResourceReference(capacitorDirectoryPath);
    });

    afterEach(() => {
      rmSync(capacitorDirectoryPath, { force: true, recursive: true });
    });

    it('should remove the file reference, its build file and its resources phase entry, and leave every other byte as it was', () => {
      expect(hasReadableResourceReference(capacitorProjectFilePath)).toBe(true);

      removeResourceReference(capacitorProjectFilePath);

      expect(hasReadableResourceReference(capacitorProjectFilePath)).toBe(
        false,
      );
      expect(readFileSync(capacitorProjectFilePath, 'utf8')).toBe(
        readFileSync(PBXPROJ_FIXTURE_PATH, 'utf8'),
      );
    });

    it('should count a project it cannot parse as one without the reference', () => {
      writeFileSync(capacitorProjectFilePath, 'not a project');

      expect(hasReadableResourceReference(capacitorProjectFilePath)).toBe(
        false,
      );
    });
  });

  describe('in a project with the phase to run after', () => {
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

    it('should keep a number with leading zeros as it was in this project too', async () => {
      writeFileSync(
        reactNativeProjectFilePath,
        readFileSync(reactNativeProjectFilePath, 'utf8').replace(
          'LastUpgradeCheck = 1210;',
          'LastUpgradeCheck = 0920;',
        ),
      );

      await addBinaryCreatePhase(
        reactNativeProjectFilePath,
        ANCHORED_PHASE,
        {},
      );

      expect(readFileSync(reactNativeProjectFilePath, 'utf8')).toContain(
        'LastUpgradeCheck = 0920;',
      );
    });

    it('should add the phase right after that phase', async () => {
      await addBinaryCreatePhase(
        reactNativeProjectFilePath,
        ANCHORED_PHASE,
        {},
      );

      expect(readFileSync(reactNativeProjectFilePath, 'utf8')).toMatch(
        /\/\* Bundle React Native code and images \*\/,\n\t+[0-9A-F]+ \/\* Create HotCodePush binary \*\/,/,
      );
    });
  });
});
