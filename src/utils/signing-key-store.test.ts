import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateSigningKeyPair } from '@hotcodepush/protocol';
import { describe, expect, it, vi } from 'vitest';
import { useCommandHarness } from '../../test/command-harness.js';
import {
  DEMO_APP,
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

  it('should read the keys of HOTCODEPUSH_SIGNING_KEY, separated by a comma, before the key file', () => {
    writeKeyFile('ed25519:fromTheFile\n');
    vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', 'ed25519:one,rsa-v1_5-sha256:two');

    expect(readSigningPrivateKeys(DEMO_APP.id)).toEqual([
      'ed25519:one',
      'rsa-v1_5-sha256:two',
    ]);
  });

  it('should read the key file, one key per line, when the variable is unset', () => {
    writeKeyFile('ed25519:one\nrsa-v1_5-sha256:two\n');

    expect(readSigningPrivateKeys(DEMO_APP.id)).toEqual([
      'ed25519:one',
      'rsa-v1_5-sha256:two',
    ]);
  });

  it('should read no key when neither the variable nor the file holds one', () => {
    expect(readSigningPrivateKeys(DEMO_APP.id)).toEqual([]);
  });

  it('should resolve the pair of the first listed public key whose private half is at hand', async () => {
    const newerKeyPair = await generateSigningKeyPair();
    const absentKeyPair = await generateSigningKeyPair();
    vi.stubEnv(
      'HOTCODEPUSH_SIGNING_KEY',
      `${newerKeyPair.privateKey},${SIGNING_PRIVATE_KEY}`,
    );

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
      (await generateSigningKeyPair()).privateKey,
    );

    const error = await resolveSigningKeyPair(DEMO_APP.id, [
      SIGNING_KEY.publicKey,
    ]).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(SigningKeyUnavailableError);
    expect((error as SigningKeyUnavailableError).fix).toContain(
      resolveSigningKeyFilePath(DEMO_APP.id),
    );
  });

  it('should refuse a private key it cannot read without repeating it', async () => {
    vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', 'ed25519:notAKey');

    const error = await resolveSigningKeyPair(DEMO_APP.id, [
      SIGNING_KEY.publicKey,
    ]).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(InvalidParameterError);
    expect((error as InvalidParameterError).message).not.toContain('notAKey');
  });

  it('should add keys to the key file after the ones it holds, readable by its owner alone', () => {
    writeSigningPrivateKeys(DEMO_APP.id, ['ed25519:one']);

    const filePath = writeSigningPrivateKeys(DEMO_APP.id, [
      'ed25519:two',
      'rsa-v1_5-sha256:three',
    ]);

    expect(filePath).toBe(resolveSigningKeyFilePath(DEMO_APP.id));
    expect(readFileSync(filePath, 'utf8')).toBe(
      'ed25519:one\ned25519:two\nrsa-v1_5-sha256:three\n',
    );
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });
});
