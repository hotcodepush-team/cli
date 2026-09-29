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
import { PBXPROJ_FIXTURE_PATH } from '../testing/capacitor-project.js';
import { XcodeProjectError } from './errors.js';
import {
  addResourceReference,
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
});
