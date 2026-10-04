import { createPrivateKey } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveProtocolSigningKey,
  SIGNING_KEY,
  SIGNING_PRIVATE_KEY,
} from '../../test/fixtures.js';
import { InvalidParameterError, SigningKeyUnavailableError } from './errors.js';
import {
  readSigningKeyPair,
  writeSigningPrivateKeyFile,
} from './signing-private-key.js';

const OTHER_PRIVATE_KEY = resolveProtocolSigningKey('rsa-4096-b').privateKey;

// The signing key as PKCS #1, the PEM Expo's tool writes, and its DER on one line
const SIGNING_KEY_OBJECT = createPrivateKey({
  format: 'der',
  key: Buffer.from(SIGNING_PRIVATE_KEY, 'base64'),
  type: 'pkcs8',
});
const PKCS1_PEM = SIGNING_KEY_OBJECT.export({
  format: 'pem',
  type: 'pkcs1',
}) as string;
const PKCS1_DER = SIGNING_KEY_OBJECT.export({
  format: 'der',
  type: 'pkcs1',
}).toString('base64');

describe('signing private key', () => {
  let directoryPath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-'));
    vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', undefined);
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  function writeKeyFile(privateKey = SIGNING_PRIVATE_KEY): string {
    const filePath = join(directoryPath, 'private-key.pem');
    writeSigningPrivateKeyFile(filePath, privateKey);
    return filePath;
  }

  async function readRejection(
    publicKeys: string[],
    privateKeyPath?: string,
  ): Promise<unknown> {
    return readSigningKeyPair(publicKeys, privateKeyPath).catch(
      (reason: unknown) => reason,
    );
  }

  it('should write the private key as a PEM file of PKCS #8', () => {
    const pem = readFileSync(writeKeyFile(), 'utf8');

    expect(pem).toMatch(
      /^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END PRIVATE KEY-----\n$/,
    );
    expect(
      createPrivateKey(pem)
        .export({ format: 'der', type: 'pkcs8' })
        .toString('base64'),
    ).toBe(SIGNING_PRIVATE_KEY);
  });

  // Windows has no POSIX file mode: the user profile's access list protects the file there
  it.skipIf(process.platform === 'win32')(
    'should write the private key file readable by its owner alone',
    () => {
      expect(statSync(writeKeyFile()).mode & 0o777).toBe(0o600);
    },
  );

  it('should never overwrite an existing file', () => {
    const filePath = join(directoryPath, 'private-key.pem');
    writeFileSync(filePath, 'kept');

    expect(() =>
      writeSigningPrivateKeyFile(filePath, SIGNING_PRIVATE_KEY),
    ).toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe('kept');
  });

  it('should read the key pair from the file --private-key-path names', async () => {
    await expect(
      readSigningKeyPair([SIGNING_KEY.publicKey], writeKeyFile()),
    ).resolves.toEqual({
      privateKey: SIGNING_PRIVATE_KEY,
      publicKey: SIGNING_KEY.publicKey,
    });
  });

  it('should read the key pair from HOTCODEPUSH_SIGNING_KEY holding the file content', async () => {
    vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', readFileSync(writeKeyFile(), 'utf8'));

    await expect(
      readSigningKeyPair([SIGNING_KEY.publicKey], undefined),
    ).resolves.toEqual({
      privateKey: SIGNING_PRIVATE_KEY,
      publicKey: SIGNING_KEY.publicKey,
    });
  });

  it('should read the key pair from a PKCS #1 file, as Expo writes it', async () => {
    const filePath = join(directoryPath, 'private-key.pem');
    writeFileSync(filePath, PKCS1_PEM);

    await expect(
      readSigningKeyPair([SIGNING_KEY.publicKey], filePath),
    ).resolves.toEqual({
      privateKey: SIGNING_PRIVATE_KEY,
      publicKey: SIGNING_KEY.publicKey,
    });
  });

  it.each([
    [
      'with the PEM lines',
      () => readFileSync(writeKeyFile(), 'utf8').replaceAll('\n', ' '),
    ],
    ['without the PEM lines', () => SIGNING_PRIVATE_KEY],
    ['as PKCS #1 with the PEM lines', () => PKCS1_PEM.replaceAll('\n', ' ')],
    ['as PKCS #1 without the PEM lines', () => PKCS1_DER],
  ])(
    'should read the key pair from HOTCODEPUSH_SIGNING_KEY on one line %s',
    async (_condition, readVariableText) => {
      vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', readVariableText());

      await expect(
        readSigningKeyPair([SIGNING_KEY.publicKey], undefined),
      ).resolves.toEqual({
        privateKey: SIGNING_PRIVATE_KEY,
        publicKey: SIGNING_KEY.publicKey,
      });
    },
  );

  it('should take the file --private-key-path names over HOTCODEPUSH_SIGNING_KEY', async () => {
    vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', OTHER_PRIVATE_KEY);

    await expect(
      readSigningKeyPair([SIGNING_KEY.publicKey], writeKeyFile()),
    ).resolves.toEqual({
      privateKey: SIGNING_PRIVATE_KEY,
      publicKey: SIGNING_KEY.publicKey,
    });
  });

  it('should answer no key pair when no public key is listed and no private key is given', async () => {
    await expect(readSigningKeyPair([], undefined)).resolves.toBeNull();
  });

  it('should throw E_SIGNING_KEY_UNAVAILABLE naming both ways when a public key is listed and no private key is given', async () => {
    const error = await readRejection([SIGNING_KEY.publicKey]);

    expect(error).toBeInstanceOf(SigningKeyUnavailableError);
    expect((error as SigningKeyUnavailableError).fix).toBe(
      'pass --private-key-path with the file "hotcodepush signing-key create" wrote, or set HOTCODEPUSH_SIGNING_KEY to its content.',
    );
  });

  it.each(['--private-key-path', 'HOTCODEPUSH_SIGNING_KEY'])(
    'should refuse a private key given through %s when no public key is listed',
    async source => {
      vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', SIGNING_PRIVATE_KEY);

      const error = await readRejection(
        [],
        source === '--private-key-path' ? writeKeyFile() : undefined,
      );

      expect(error).toBeInstanceOf(InvalidParameterError);
      expect((error as InvalidParameterError).message).toBe(
        `${source}: a private key is given and hotcodepush.json lists no public key of the app`,
      );
    },
  );

  it('should refuse a private key that belongs to no listed public key, without repeating it', async () => {
    vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', OTHER_PRIVATE_KEY);

    const error = await readRejection([SIGNING_KEY.publicKey]);

    expect(error).toBeInstanceOf(InvalidParameterError);
    expect((error as InvalidParameterError).message).toBe(
      'HOTCODEPUSH_SIGNING_KEY: the private key belongs to no public key hotcodepush.json lists',
    );
  });

  it('should throw E_INVALID_PARAMETER naming the flag when no file is at --private-key-path', async () => {
    const filePath = join(directoryPath, 'missing.pem');

    const error = await readRejection([SIGNING_KEY.publicKey], filePath);

    expect(error).toBeInstanceOf(InvalidParameterError);
    expect((error as InvalidParameterError).message).toBe(
      `--private-key-path: cannot read ${filePath}`,
    );
  });

  it.each([
    ['PKCS #8', 'pkcs8'],
    ['PKCS #1', 'pkcs1'],
  ] as const)(
    'should refuse an encrypted %s private key, saying so',
    async (_encoding, type) => {
      const filePath = join(directoryPath, 'private-key.pem');
      writeFileSync(
        filePath,
        SIGNING_KEY_OBJECT.export({
          cipher: 'aes-256-cbc',
          format: 'pem',
          passphrase: 'invented-passphrase',
          type,
        }),
      );

      const error = await readRejection([SIGNING_KEY.publicKey], filePath);

      expect(error).toBeInstanceOf(InvalidParameterError);
      expect((error as InvalidParameterError).message).toBe(
        '--private-key-path: an encrypted private key is not supported',
      );
    },
  );

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

      const error = await readRejection([SIGNING_KEY.publicKey]);

      expect(error).toBeInstanceOf(InvalidParameterError);
      expect((error as InvalidParameterError).message).toBe(
        'HOTCODEPUSH_SIGNING_KEY: no RSA private key of 2048 bits or more',
      );
    },
  );
});
