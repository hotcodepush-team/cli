import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidParameterError } from './errors.js';
import {
  assertProjectConfigAppId,
  readProjectConfig,
  resolveProjectChannel,
} from './project-config.js';

const PROJECT_CONFIG = {
  appId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  channel: 'staging',
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

  it('should throw E_INVALID_JSON naming hotcodepush.json when it does not parse', () => {
    const configPath = join(projectPath, 'hotcodepush.json');
    writeFileSync(configPath, '{ "appId": ');

    expect(() => readProjectConfig(configPath)).toThrow(
      expect.objectContaining({
        code: 'E_INVALID_JSON',
        message: `${configPath} is no valid JSON: unexpected end of JSON input`,
      }),
    );
  });

  it('should pass an app id of the file', () => {
    expect(() => assertProjectConfigAppId(PROJECT_CONFIG.appId)).not.toThrow();
  });

  it('should throw E_INVALID_PARAMETER naming appId when it is no id', () => {
    expect(() => assertProjectConfigAppId('x & calc')).toThrow(
      expect.objectContaining({
        code: 'E_INVALID_PARAMETER',
        fix: 'set appId to the id "hotcodepush app list" prints.',
        message: 'hotcodepush.json: appId is no id',
      }),
    );
  });

  it('should resolve the channel by name, production when the file names none', () => {
    expect(resolveProjectChannel(PROJECT_CONFIG)).toBe('staging');
    expect(resolveProjectChannel({ appId: PROJECT_CONFIG.appId })).toBe(
      'production',
    );
  });
});
