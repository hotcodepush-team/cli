import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidParameterError } from './errors.js';
import { assertProjectConfigId, readProjectConfig } from './project-config.js';

const PROJECT_CONFIG = {
  appId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  channelId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
};

describe('project config', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'hotcodepush-project-'));
  });

  afterEach(() => {
    rmSync(projectPath, { force: true, recursive: true });
  });

  it('should read the nearest hotcodepush.json walking up from the working directory', () => {
    writeFileSync(
      join(projectPath, 'hotcodepush.json'),
      JSON.stringify(PROJECT_CONFIG),
    );
    const nestedPath = join(projectPath, 'src', 'app');
    mkdirSync(nestedPath, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(nestedPath);

    expect(readProjectConfig(undefined)).toEqual(PROJECT_CONFIG);
  });

  it('should read the file --config names instead of searching', () => {
    const configPath = join(projectPath, 'apps', 'demo.json');
    mkdirSync(join(projectPath, 'apps'));
    writeFileSync(configPath, JSON.stringify(PROJECT_CONFIG));

    expect(readProjectConfig(configPath)).toEqual(PROJECT_CONFIG);
  });

  it('should throw E_INVALID_PARAMETER when --config names a missing file', () => {
    expect(() => readProjectConfig(join(projectPath, 'missing.json'))).toThrow(
      InvalidParameterError,
    );
  });

  it('should pass an id of the file', () => {
    expect(() =>
      assertProjectConfigId('appId', PROJECT_CONFIG.appId),
    ).not.toThrow();
  });

  it.each([
    ['appId', 'app'],
    ['channelId', 'channel'],
  ] as const)(
    'should throw E_INVALID_PARAMETER naming %s when it is no id',
    (field, noun) => {
      expect(() => assertProjectConfigId(field, 'x & calc')).toThrow(
        expect.objectContaining({
          code: 'E_INVALID_PARAMETER',
          fix: `set ${field} to the id "hotcodepush ${noun} list" prints.`,
          message: `hotcodepush.json: ${field} is no id`,
        }),
      );
    },
  );
});
