import { setTimeout } from 'node:timers/promises';
import { defineCommand } from 'zodline';
import { CLI_CLIENT_ID } from '../config/consts.js';
import type { AuthClient } from '../utils/auth-client.js';
import {
  createApiAuthClient,
  fetchSession,
  resolveResponseData,
} from '../utils/auth-client.js';
import { openBrowser } from '../utils/browser.js';
import { isInteractive } from '../utils/environment.js';
import { resolveApiError } from '../utils/error-mapping.js';
import type { DeviceAuthorizationPrompt } from '../utils/errors.js';
import {
  LoginDeniedError,
  LoginExpiredError,
  LoginPendingError,
  NotLoggedInError,
} from '../utils/errors.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { writeToken } from '../utils/token-store.js';
import { readUserConfig, writeUserConfig } from '../utils/user-config.js';

interface DeviceAuthorization {
  device_code: string;
  expires_in: number;
  interval: number;
  user_code: string;
  verification_uri_complete: string;
}

const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

// RFC 8628, section 3.5: every slow_down adds five seconds to the interval of this and every later request
const SLOW_DOWN_INCREMENT_SECONDS = 5;

export default defineCommand({
  action: async options => {
    const authClient = createApiAuthClient();
    const isLoginInteractive = isInteractive(options);
    const sessionToken =
      (await redeemPendingDeviceCode(authClient, isLoginInteractive)) ??
      (await fetchSessionTokenForNewDeviceCode(authClient, isLoginInteractive));
    const { session, user } = await fetchSession(
      createApiAuthClient(sessionToken),
    );
    writeToken(sessionToken);
    writeUserConfig({ ...readUserConfig(), sessionId: session.id });
    if (options.json) {
      printJson({ user: { email: user.email, id: user.id, name: user.name } });
    } else {
      console.log(`Logged in as ${user.name} (${user.email}).`);
    }
  },
  description: 'Log in by approving a one-time code in the browser.',
  examples: ['hotcodepush login', 'hotcodepush login --json'],
  options: defineCommandOptions({}),
});

/**
 * Polls at the server's interval until the person approves or denies the code, or the code expires.
 */
async function fetchApprovedSessionToken(
  authClient: AuthClient,
  { device_code, interval }: DeviceAuthorization,
): Promise<string> {
  let intervalSeconds = interval;
  for (;;) {
    await setTimeout(intervalSeconds * 1000);
    const { data, error } = await fetchDeviceToken(authClient, device_code);
    if (error === null) {
      return data.access_token;
    }
    switch (error.error) {
      case 'access_denied':
        throw new LoginDeniedError();
      case 'authorization_pending':
        break;
      case 'expired_token':
        throw new LoginExpiredError();
      case 'slow_down':
        intervalSeconds += SLOW_DOWN_INCREMENT_SECONDS;
        break;
      default:
        throw resolveApiError(error);
    }
  }
}

function fetchDeviceToken(authClient: AuthClient, deviceCode: string) {
  return authClient.device.token({
    client_id: CLI_CLIENT_ID,
    device_code: deviceCode,
    grant_type: DEVICE_CODE_GRANT_TYPE,
  });
}

/**
 * A login that cannot wait for the approval keeps the code for the next one and exits with the page and the code;
 * an interactive one opens the page and polls.
 */
async function fetchSessionTokenForNewDeviceCode(
  authClient: AuthClient,
  isLoginInteractive: boolean,
): Promise<string> {
  const deviceAuthorization = resolveResponseData(
    await authClient.device.code({ client_id: CLI_CLIENT_ID }),
  );
  const prompt = resolveDeviceAuthorizationPrompt(deviceAuthorization);
  if (!isLoginInteractive) {
    writePendingDeviceCode(deviceAuthorization);
    throw new NotLoggedInError(prompt);
  }
  console.log(
    `Open ${prompt.verificationUrl} and approve the code ${prompt.userCode}.`,
  );
  console.log('Waiting for the approval…');
  openBrowser(prompt.verificationUrl);
  return fetchApprovedSessionToken(authClient, deviceAuthorization);
}

function deletePendingDeviceCode(): void {
  const userConfig = readUserConfig();
  delete userConfig.pendingDeviceCode;
  delete userConfig.pendingDeviceCodeExpiresAt;
  writeUserConfig(userConfig);
}

/**
 * One token request for the code a non-interactive login kept: the session token once the code is approved,
 * nothing once it is denied, expired or unknown, so a new code follows.
 * Still pending, a non-interactive login waits for it rather than replace the code the person was given;
 * an interactive one takes a new code, since the person at the terminal never saw the kept one.
 */
async function redeemPendingDeviceCode(
  authClient: AuthClient,
  isLoginInteractive: boolean,
): Promise<string | undefined> {
  const { pendingDeviceCode, pendingDeviceCodeExpiresAt } = readUserConfig();
  if (pendingDeviceCode === undefined) {
    return undefined;
  }
  if (
    pendingDeviceCodeExpiresAt === undefined ||
    new Date(pendingDeviceCodeExpiresAt) <= new Date()
  ) {
    deletePendingDeviceCode();
    return undefined;
  }
  const { data, error } = await fetchDeviceToken(authClient, pendingDeviceCode);
  if (error === null) {
    deletePendingDeviceCode();
    return data.access_token;
  }
  switch (error.error) {
    case 'access_denied':
    case 'expired_token':
    case 'invalid_grant':
      deletePendingDeviceCode();
      return undefined;
    case 'authorization_pending':
    case 'slow_down':
      if (!isLoginInteractive) {
        throw new LoginPendingError();
      }
      deletePendingDeviceCode();
      return undefined;
    default:
      throw resolveApiError(error);
  }
}

function resolveDeviceAuthorizationPrompt({
  user_code,
  verification_uri_complete,
}: DeviceAuthorization): DeviceAuthorizationPrompt {
  return { userCode: user_code, verificationUrl: verification_uri_complete };
}

function writePendingDeviceCode({
  device_code,
  expires_in,
}: DeviceAuthorization): void {
  writeUserConfig({
    ...readUserConfig(),
    pendingDeviceCode: device_code,
    pendingDeviceCodeExpiresAt: new Date(
      Date.now() + expires_in * 1000,
    ).toISOString(),
  });
}
