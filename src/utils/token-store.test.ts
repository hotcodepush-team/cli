import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readUserConfig, writeUserConfig } from './user-config.js';

const keyring = vi.hoisted(() => ({
  deletePassword: vi.fn(),
  getPassword: vi.fn(),
  setPassword: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () {
    return keyring;
  }),
}));

function failKeyring(): void {
  const throwPlatformFailure = () => {
    throw new Error('Platform failure');
  };
  keyring.deletePassword.mockImplementation(throwPlatformFailure);
  keyring.getPassword.mockImplementation(throwPlatformFailure);
  keyring.setPassword.mockImplementation(throwPlatformFailure);
}

// A fresh module per test, since the latch lives for the rest of the process
async function importTokenStore() {
  vi.resetModules();
  return import('./token-store.js');
}

describe('token store', () => {
  let configHomePath: string;

  beforeEach(() => {
    configHomePath = mkdtempSync(join(tmpdir(), 'hotcodepush-'));
    vi.stubEnv('XDG_CONFIG_HOME', configHomePath);
    vi.stubEnv('HOTCODEPUSH_TOKEN', undefined);
    keyring.deletePassword.mockReset().mockReturnValue(true);
    keyring.getPassword.mockReset().mockReturnValue(null);
    keyring.setPassword.mockReset();
  });

  afterEach(() => {
    rmSync(configHomePath, { force: true, recursive: true });
  });

  it('should read HOTCODEPUSH_TOKEN before the keyring when it is set', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', 'environment-token');
    keyring.getPassword.mockReturnValue('keyring-token');
    const { readToken } = await importTokenStore();

    expect(readToken()).toBe('environment-token');
  });

  describe('when the keyring works', () => {
    it('should read the token from the keyring', async () => {
      keyring.getPassword.mockReturnValue('keyring-token');
      const { readToken } = await importTokenStore();

      expect(readToken()).toBe('keyring-token');
    });

    it('should read nothing when no token is stored', async () => {
      const { readToken } = await importTokenStore();

      expect(readToken()).toBeUndefined();
    });

    it('should write the token to the keyring and remove a copy from config.json', async () => {
      writeUserConfig({ sessionId: 'session-1', token: 'old-token' });
      const { writeToken } = await importTokenStore();

      writeToken('new-token');

      expect(keyring.setPassword).toHaveBeenCalledWith('new-token');
      expect(readUserConfig()).toEqual({ sessionId: 'session-1' });
    });

    it('should delete the token from the keyring and config.json', async () => {
      writeUserConfig({ sessionId: 'session-1', token: 'old-token' });
      const { deleteToken } = await importTokenStore();

      deleteToken();

      expect(keyring.deletePassword).toHaveBeenCalled();
      expect(readUserConfig()).toEqual({ sessionId: 'session-1' });
    });
  });

  describe('when the keyring fails', () => {
    it('should read the token from config.json', async () => {
      failKeyring();
      writeUserConfig({ token: 'file-token' });
      const { readToken } = await importTokenStore();

      expect(readToken()).toBe('file-token');
    });

    it('should write the token to config.json, keeping the other keys', async () => {
      failKeyring();
      writeUserConfig({ sessionId: 'session-1' });
      const { writeToken } = await importTokenStore();

      writeToken('file-token');

      expect(readUserConfig()).toEqual({
        sessionId: 'session-1',
        token: 'file-token',
      });
    });

    it('should not read a stale keyring token after a failed write', async () => {
      keyring.getPassword.mockReturnValue('stale-keyring-token');
      keyring.setPassword.mockImplementation(() => {
        throw new Error('Platform failure');
      });
      const { readToken, writeToken } = await importTokenStore();

      writeToken('new-token');

      expect(readToken()).toBe('new-token');
      expect(keyring.getPassword).not.toHaveBeenCalled();
    });

    it('should not read a stale keyring token after a failed delete', async () => {
      keyring.getPassword.mockReturnValue('stale-keyring-token');
      keyring.deletePassword.mockImplementation(() => {
        throw new Error('Platform failure');
      });
      const { deleteToken, readToken } = await importTokenStore();

      deleteToken();

      expect(readToken()).toBeUndefined();
    });

    it('should leave the keyring alone once it failed', async () => {
      failKeyring();
      const { readToken, writeToken } = await importTokenStore();
      readToken();
      keyring.setPassword.mockClear();

      writeToken('file-token');

      expect(keyring.setPassword).not.toHaveBeenCalled();
      expect(readUserConfig().token).toBe('file-token');
    });
  });
});
