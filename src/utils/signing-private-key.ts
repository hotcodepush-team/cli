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

/**
 * A private key given to an upload, with the flag or variable it came through, which every message about the key names;
 * the key itself never reaches a message.
 */
interface GivenPrivateKey {
  source: '--private-key-path' | 'HOTCODEPUSH_SIGNING_KEY';
  text: string;
}

type PrivateKeyEncoding = 'pkcs1' | 'pkcs8';

// PKCS #8's encrypted PEM and PKCS #1's, whose header names its cipher
const ENCRYPTED_KEY_PATTERN = /ENCRYPTED PRIVATE KEY|Proc-Type:/;

// The PEM's first and last line, of PKCS #8 or of PKCS #1 as Expo's tool writes it, dropped with all whitespace so the key
// pasted on one line reads as the file does
const PEM_BOUNDARY_PATTERN = /-----(BEGIN|END) (RSA )?PRIVATE KEY-----/g;

const WHITESPACE_PATTERN = /\s/g;

/**
 * The key pair an upload signs with, null where signing is off: the private key of the file `--private-key-path` names,
 * otherwise the one `HOTCODEPUSH_SIGNING_KEY` holds, belonging to a public key `hotcodepush.json` lists.
 * Listed keys and no private key stop the upload, since the app would refuse the unsigned bundle;
 * a private key and no listed key stop it too, rather than the key being ignored.
 */
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
      `${givenPrivateKey.source}: a private key is given and ${PROJECT_CONFIG_FILE_NAME} lists no public key of the app`,
      undefined,
      `add its public key to publicKeys in ${PROJECT_CONFIG_FILE_NAME}, as "hotcodepush signing-key list --json" prints it, or give no private key.`,
    );
  }
  const signingKeyPair = await resolveSigningKeyPair(givenPrivateKey);
  if (!publicKeys.includes(signingKeyPair.publicKey)) {
    throw new InvalidParameterError(
      `${givenPrivateKey.source}: the private key belongs to no public key ${PROJECT_CONFIG_FILE_NAME} lists`,
      undefined,
      `give the private key of a public key ${PROJECT_CONFIG_FILE_NAME} lists; "hotcodepush signing-key create" makes a new pair.`,
    );
  }
  return signingKeyPair;
}

/**
 * Writes the private key as a PEM file of PKCS #8 through Node's own export, readable by its owner alone on macOS and
 * Linux; an existing file is never overwritten.
 */
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

/**
 * The key through Node's own import, in each encoding its PEM lines name, or without them PKCS #8 and then PKCS #1.
 */
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
  // an empty variable is unset, as a CI renders a secret it does not hold
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
      `--private-key-path: cannot read ${filePath}`,
      error,
      'pass the private key file "hotcodepush signing-key create" wrote.',
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

/**
 * The private key in the form the protocol signs with, the base64 of its PKCS #8 DER, and its public half.
 */
async function resolveSigningKeyPair({
  source,
  text,
}: GivenPrivateKey): Promise<SigningKeyPair> {
  if (ENCRYPTED_KEY_PATTERN.test(text)) {
    throw new InvalidParameterError(
      `${source}: an encrypted private key is not supported`,
      undefined,
      'remove its passphrase first, as "openssl pkey -in <file> -out <new file>" does.',
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
      `${source}: no RSA private key of ${SIGNING_KEY_BITS_MINIMUM} bits or more`,
      error,
      'give the private key file "hotcodepush signing-key create" wrote, or its content in HOTCODEPUSH_SIGNING_KEY.',
    );
  }
}
