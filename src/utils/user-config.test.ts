import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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
    vi.stubEnv('APPDATA', configHomePath);
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

  it('should write config.json as JSON in the hotcodepush directory', () => {
    writeUserConfig({ sessionId: 'session-1' });

    const fileContent = readFileSync(
      join(configHomePath, 'hotcodepush', 'config.json'),
      'utf8',
    );
    expect(JSON.parse(fileContent)).toEqual({ sessionId: 'session-1' });
  });

  it('should write the file readable by its owner only', () => {
    writeUserConfig({ token: 'token-1' });

    const fileMode =
      statSync(join(configHomePath, 'hotcodepush', 'config.json')).mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  it('should make an existing file readable by its owner only', () => {
    const directoryPath = join(configHomePath, 'hotcodepush');
    mkdirSync(directoryPath);
    writeFileSync(join(directoryPath, 'config.json'), '{}', { mode: 0o644 });

    writeUserConfig({ token: 'token-1' });

    const fileMode = statSync(join(directoryPath, 'config.json')).mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  it('should resolve the directory under XDG_CONFIG_HOME when on macOS or Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    expect(resolveConfigDirectoryPath()).toBe(
      join(configHomePath, 'hotcodepush'),
    );
  });

  it('should resolve the directory under ~/.config when XDG_CONFIG_HOME is unset', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.stubEnv('XDG_CONFIG_HOME', undefined);

    expect(resolveConfigDirectoryPath()).toBe(
      join(homedir(), '.config', 'hotcodepush'),
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
