import { createPrivateKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  resolvePublicKeyOfPrivateKey,
  SIGNING_KEY_BITS_MINIMUM,
} from '@hotcodepush/protocol';
import type { SigningKeyPair } from '@hotcodepush/protocol';
import { PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import { InvalidParameterError, SigningKeyUnavailableError } from './errors.js';

// Every message about the key names its source, but never the key itself.
interface GivenPrivateKey {
  source: '--private-key-path' | 'HOTCODEPUSH_SIGNING_KEY';
  text: string;
}

type PrivateKeyEncoding = 'pkcs1' | 'pkcs8';

// Matches an encrypted PKCS #8 PEM, or a PKCS #1 PEM whose header names its cipher.
const ENCRYPTED_KEY_PATTERN = /ENCRYPTED PRIVATE KEY|Proc-Type:/;

// Matches the first and last PEM line of PKCS #8, or of PKCS #1 as the Expo tool writes it.
// They are dropped with all whitespace, so a key pasted on one line reads like the file.
const PEM_BOUNDARY_PATTERN = /-----(BEGIN|END) (RSA )?PRIVATE KEY-----/g;

const WHITESPACE_PATTERN = /\s/g;

// A private key without a listed public key stops the upload, rather than being ignored.
export async function readSigningKeyPair(
  publicKeys: readonly string[],
  privateKeyPath: string | undefined,
): Promise<SigningKeyPair | null> {
  const givenPrivateKey = readGivenPrivateKey(privateKeyPath);
  if (givenPrivateKey === undefined) {
    if (publicKeys.length > 0) {
      throw new SigningKeyUnavailableError();
    }
    return null;
  }
  if (publicKeys.length === 0) {
    throw new InvalidParameterError(
      `A private key is given from ${givenPrivateKey.source}, and ${PROJECT_CONFIG_FILE_NAME} lists no public key of the app.`,
      `Add its public key to publicKeys in ${PROJECT_CONFIG_FILE_NAME}, as "hotcodepush signing-key list --json" prints it, or give no private key.`,
    );
  }
  const signingKeyPair = await resolveSigningKeyPair(givenPrivateKey);
  if (!publicKeys.includes(signingKeyPair.publicKey)) {
    throw new InvalidParameterError(
      `The private key from ${givenPrivateKey.source} belongs to no public key ${PROJECT_CONFIG_FILE_NAME} lists.`,
      `Give the private key of a public key ${PROJECT_CONFIG_FILE_NAME} lists, or make a new pair with "hotcodepush signing-key create".`,
    );
  }
  return signingKeyPair;
}

// The public half is derived from the private key, so the two cannot mismatch.
export function readSigningKeyPairFile(
  privateKeyPath: string,
): Promise<SigningKeyPair> {
  return resolveSigningKeyPair({
    source: '--private-key-path',
    text: readPrivateKeyFile(privateKeyPath),
  });
}

export function writeSigningPrivateKeyFile(
  filePath: string,
  privateKey: string,
): void {
  const pem = createPrivateKey({
    format: 'der',
    key: Buffer.from(privateKey, 'base64'),
    type: 'pkcs8',
  }).export({ format: 'pem', type: 'pkcs8' });
  writeFileSync(filePath, pem, { flag: 'wx', mode: 0o600 });
}

function importPrivateKey(text: string): KeyObject {
  const key = Buffer.from(
    text.replace(PEM_BOUNDARY_PATTERN, '').replace(WHITESPACE_PATTERN, ''),
    'base64',
  );
  let importError: unknown;
  for (const type of resolvePrivateKeyEncodings(text)) {
    try {
      return createPrivateKey({ format: 'der', key, type });
    } catch (error) {
      importError = error;
    }
  }
  throw importError;
}

function readGivenPrivateKey(
  privateKeyPath: string | undefined,
): GivenPrivateKey | undefined {
  if (privateKeyPath !== undefined) {
    return {
      source: '--private-key-path',
      text: readPrivateKeyFile(privateKeyPath),
    };
  }
  // An empty variable counts as unset, since a CI renders a secret it does not hold as empty.
  const variableText = process.env.HOTCODEPUSH_SIGNING_KEY;
  return variableText
    ? { source: 'HOTCODEPUSH_SIGNING_KEY', text: variableText }
    : undefined;
}

function readPrivateKeyFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new InvalidParameterError(
      `The file ${filePath} from --private-key-path cannot be read.`,
      'Pass the path of the private key file, a PEM of PKCS #8 or PKCS #1.',
      error,
    );
  }
}

function resolvePrivateKeyEncodings(text: string): PrivateKeyEncoding[] {
  if (text.includes('BEGIN RSA PRIVATE KEY')) {
    return ['pkcs1'];
  }
  if (text.includes('BEGIN PRIVATE KEY')) {
    return ['pkcs8'];
  }
  return ['pkcs8', 'pkcs1'];
}

// The protocol signs with the base64 of the PKCS #8 DER.
async function resolveSigningKeyPair({
  source,
  text,
}: GivenPrivateKey): Promise<SigningKeyPair> {
  if (ENCRYPTED_KEY_PATTERN.test(text)) {
    throw new InvalidParameterError(
      `The private key from ${source} is encrypted, which is not supported.`,
      'Remove its passphrase first, as "openssl pkey -in <file> -out <new file>" does.',
    );
  }
  try {
    const privateKey = importPrivateKey(text)
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    return {
      privateKey,
      publicKey: await resolvePublicKeyOfPrivateKey(privateKey),
    };
  } catch (error) {
    throw new InvalidParameterError(
      `The key from ${source} is not an RSA private key of ${SIGNING_KEY_BITS_MINIMUM} bits or more.`,
      `Give an RSA private key of ${SIGNING_KEY_BITS_MINIMUM} bits or more, a PEM of PKCS #8 or PKCS #1.`,
      error,
    );
  }
}
