import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readUserConfig,
  resolveConfigDirectoryPath,
  writeUserConfig,
} from './user-config.js';

const originalPlatform = process.platform;

describe('user config', () => {
  let configHomePath: string;

  beforeEach(() => {
    configHomePath = mkdtempSync(join(tmpdir(), 'hotcodepush-'));
    vi.stubEnv('XDG_CONFIG_HOME', configHomePath);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    rmSync(configHomePath, { force: true, recursive: true });
  });

  it('should read an empty config when the file does not exist', () => {
    expect(readUserConfig()).toEqual({});
  });

  it('should read back what it wrote', () => {
    writeUserConfig({
      apiUrl: 'https://api.example.com',
      sessionId: 'session-1',
    });

    expect(readUserConfig()).toEqual({
      apiUrl: 'https://api.example.com',
      sessionId: 'session-1',
    });
  });

  it('should write config.json in the hotcodepush directory', () => {
    writeUserConfig({ sessionId: 'session-1' });

    expect(
      readFileSync(join(configHomePath, 'hotcodepush', 'config.json'), 'utf8'),
    ).toContain('session-1');
  });

  it('should write the file readable by its owner only', () => {
    writeUserConfig({ token: 'token-1' });

    const fileMode =
      statSync(join(configHomePath, 'hotcodepush', 'config.json')).mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  it('should resolve the directory under XDG_CONFIG_HOME when on macOS or Linux', () => {
    expect(resolveConfigDirectoryPath()).toBe(
      join(configHomePath, 'hotcodepush'),
    );
  });

  it('should resolve the directory under APPDATA when on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.stubEnv('APPDATA', join(configHomePath, 'AppData'));

    expect(resolveConfigDirectoryPath()).toBe(
      join(configHomePath, 'AppData', 'hotcodepush'),
    );
  });
});
