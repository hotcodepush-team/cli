import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { useCommandHarness } from '../../test/command-harness.js';
import {
  DEMO_APP,
  resolveProtocolSigningKey,
  SIGNING_KEY,
  SIGNING_PRIVATE_KEY,
} from '../../test/fixtures.js';
import { InvalidParameterError, SigningKeyUnavailableError } from './errors.js';
import {
  readSigningPrivateKeys,
  resolveSigningKeyFilePath,
  resolveSigningKeyPair,
  writeSigningPrivateKeys,
} from './signing-key-store.js';

describe('signing key store', () => {
  useCommandHarness();

  function writeKeyFile(content: string): void {
    const filePath = resolveSigningKeyFilePath(DEMO_APP.id);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  it('should read the key of HOTCODEPUSH_SIGNING_KEY before the key file', () => {
    writeKeyFile('ZnJvbVRoZUZpbGU=\n');
    vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', 'ZnJvbVRoZVNlY3JldA==\n');

    expect(readSigningPrivateKeys(DEMO_APP.id)).toEqual([
      'ZnJvbVRoZVNlY3JldA==',
    ]);
  });

  it('should read the key file, one key per line, when the variable is unset', () => {
    writeKeyFile('b25l\ndHdv\n');

    expect(readSigningPrivateKeys(DEMO_APP.id)).toEqual(['b25l', 'dHdv']);
  });

  it('should read no key when neither the variable nor the file holds one', () => {
    expect(readSigningPrivateKeys(DEMO_APP.id)).toEqual([]);
  });

  it('should resolve the pair of the first listed public key whose private half is at hand', async () => {
    const newerKeyPair = resolveProtocolSigningKey('rsa-2048');
    const absentKeyPair = resolveProtocolSigningKey('rsa-4096-b');
    writeKeyFile(`${newerKeyPair.privateKey}\n${SIGNING_PRIVATE_KEY}\n`);

    await expect(
      resolveSigningKeyPair(DEMO_APP.id, [
        absentKeyPair.publicKey,
        SIGNING_KEY.publicKey,
        newerKeyPair.publicKey,
      ]),
    ).resolves.toEqual({
      privateKey: SIGNING_PRIVATE_KEY,
      publicKey: SIGNING_KEY.publicKey,
    });
  });

  it('should throw E_SIGNING_KEY_UNAVAILABLE naming the key file when no private key belongs to a listed public key', async () => {
    vi.stubEnv(
      'HOTCODEPUSH_SIGNING_KEY',
      resolveProtocolSigningKey('rsa-4096-b').privateKey,
    );

    const error = await resolveSigningKeyPair(DEMO_APP.id, [
      SIGNING_KEY.publicKey,
    ]).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(SigningKeyUnavailableError);
    expect((error as SigningKeyUnavailableError).fix).toContain(
      resolveSigningKeyFilePath(DEMO_APP.id),
    );
  });

  it.each([
    ['is no key at all', 'bm90QUtleQ=='],
    [
      'is under the minimum size',
      resolveProtocolSigningKey('rsa-1024').privateKey,
    ],
    [
      'is in the form a key had before signing became RSA',
      'ed25519:MC4CAQAwBQYDK2VwBCIEIAjN1Scub3Am52jlsFBD2tRBZIaFbv1sMbNJipZMjOL0',
    ],
  ])(
    'should refuse a private key that %s, without repeating it',
    async (_condition, privateKey) => {
      vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', privateKey);

      const error = await resolveSigningKeyPair(DEMO_APP.id, [
        SIGNING_KEY.publicKey,
      ]).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(InvalidParameterError);
      expect((error as InvalidParameterError).message).not.toContain(
        privateKey.slice(0, 24),
      );
    },
  );

  it('should add a key to the key file after the ones it holds, readable by its owner alone', () => {
    writeSigningPrivateKeys(DEMO_APP.id, ['b25l']);

    const filePath = writeSigningPrivateKeys(DEMO_APP.id, ['dHdv']);

    expect(filePath).toBe(resolveSigningKeyFilePath(DEMO_APP.id));
    expect(readFileSync(filePath, 'utf8')).toBe('b25l\ndHdv\n');
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });
});
