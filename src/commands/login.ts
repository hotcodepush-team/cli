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
import type { InteractivityOptions } from '../utils/environment.js';
import { isInteractive } from '../utils/environment.js';
import { resolveApiError } from '../utils/error-mapping.js';
import {
  LoginDeniedError,
  LoginExpiredError,
  NotLoggedInError,
} from '../utils/errors.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { writeToken } from '../utils/token-store.js';
import { readUserConfig, writeUserConfig } from '../utils/user-config.js';

interface DeviceAuthorization {
  deviceCode: string;
  expiresAt: string;
  intervalSeconds: number;
  userCode: string;
  verificationUrl: string;
}

// RFC 8628, section 3.2: without an interval from the server a client polls every five seconds, as for a kept code
const DEFAULT_INTERVAL_SECONDS = 5;

const DEVICE_CODE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

// RFC 8628, section 3.5: every slow_down adds five seconds to the interval of this and every later request
const SLOW_DOWN_INCREMENT_SECONDS = 5;

export interface LoggedInUser {
  email: string;
  id: string;
  name: string;
}

export default defineCommand({
  description: 'Log in by approving a one-time code in the browser.',
  examples: ['hotcodepush login', 'hotcodepush login --json'],
  options: defineCommandOptions({}),
  action: async options => {
    const user = await logIn(options);
    if (options.json) {
      printJson({ user });
    } else {
      console.log(`Logged in as ${user.name} (${user.email}).`);
    }
  },
});

/**
 * The login flow as a command runs it in place: the session stored, the pending code cleared and the user returned;
 * the page and the code a person must act on go to stderr, so the caller's stdout stays its own.
 */
export async function logIn(
  options: InteractivityOptions,
): Promise<LoggedInUser> {
  const authClient = createApiAuthClient();
  const sessionToken = await fetchSessionToken(
    authClient,
    isInteractive(options),
  );
  const { session, user } = await fetchSession(
    createApiAuthClient(sessionToken),
  );
  writeToken(sessionToken);
  deletePendingDeviceAuthorization();
  writeUserConfig({ ...readUserConfig(), sessionId: session.id });
  return { email: user.email, id: user.id, name: user.name };
}

/**
 * Polls at the interval until the person approves or denies the code, or the code expires.
 */
async function fetchApprovedSessionToken(
  authClient: AuthClient,
  { deviceCode, intervalSeconds }: DeviceAuthorization,
): Promise<string> {
  let currentIntervalSeconds = intervalSeconds;
  for (;;) {
    await setTimeout(currentIntervalSeconds * 1000);
    const { data, error } = await fetchDeviceToken(authClient, deviceCode);
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
        currentIntervalSeconds += SLOW_DOWN_INCREMENT_SECONDS;
        break;
      default:
        throw resolveApiError(error);
    }
  }
}

async function fetchDeviceAuthorization(
  authClient: AuthClient,
): Promise<DeviceAuthorization> {
  const {
    device_code,
    expires_in,
    interval,
    user_code,
    verification_uri_complete,
  } = resolveResponseData(
    await authClient.device.code({ client_id: CLI_CLIENT_ID }),
  );
  return {
    deviceCode: device_code,
    expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
    intervalSeconds: interval,
    userCode: user_code,
    verificationUrl: verification_uri_complete,
  };
}

function fetchDeviceToken(authClient: AuthClient, deviceCode: string) {
  return authClient.device.token({
    client_id: CLI_CLIENT_ID,
    device_code: deviceCode,
    grant_type: DEVICE_CODE_GRANT_TYPE,
  });
}

/**
 * The code a non-interactive login kept comes first, with one token request: approved, it yields the session;
 * still pending, it is shown again. A code denied, expired, unknown to the server or never kept gives way to a new one.
 */
async function fetchSessionToken(
  authClient: AuthClient,
  isLoginInteractive: boolean,
): Promise<string> {
  const pendingDeviceAuthorization = readPendingDeviceAuthorization();
  if (
    pendingDeviceAuthorization !== undefined &&
    !isDeviceAuthorizationExpired(pendingDeviceAuthorization)
  ) {
    const { data, error } = await fetchDeviceToken(
      authClient,
      pendingDeviceAuthorization.deviceCode,
    );
    if (error === null) {
      return data.access_token;
    }
    switch (error.error) {
      case 'access_denied':
      case 'expired_token':
      case 'invalid_grant':
        break;
      case 'authorization_pending':
      case 'slow_down':
        return fetchSessionTokenOnApproval(
          authClient,
          pendingDeviceAuthorization,
          isLoginInteractive,
        );
      default:
        throw resolveApiError(error);
    }
  }
  deletePendingDeviceAuthorization();
  return fetchSessionTokenOnApproval(
    authClient,
    await fetchDeviceAuthorization(authClient),
    isLoginInteractive,
  );
}

/**
 * A login that cannot wait for the approval keeps the code for the next one and exits with the page and the code;
 * an interactive one shows them, opens the page and polls.
 */
async function fetchSessionTokenOnApproval(
  authClient: AuthClient,
  deviceAuthorization: DeviceAuthorization,
  isLoginInteractive: boolean,
): Promise<string> {
  if (!isLoginInteractive) {
    writePendingDeviceAuthorization(deviceAuthorization);
    throw new NotLoggedInError(deviceAuthorization);
  }
  process.stderr.write(
    `Open ${deviceAuthorization.verificationUrl} and approve the code ${deviceAuthorization.userCode}.\nWaiting for the approval…\n`,
  );
  openBrowser(deviceAuthorization.verificationUrl);
  return fetchApprovedSessionToken(authClient, deviceAuthorization);
}

function deletePendingDeviceAuthorization(): void {
  const userConfig = readUserConfig();
  if (userConfig.pendingDeviceCode === undefined) {
    return;
  }
  delete userConfig.pendingDeviceCode;
  delete userConfig.pendingDeviceCodeExpiresAt;
  delete userConfig.pendingUserCode;
  delete userConfig.pendingVerificationUrl;
  writeUserConfig(userConfig);
}

function isDeviceAuthorizationExpired({
  expiresAt,
}: DeviceAuthorization): boolean {
  return new Date(expiresAt) <= new Date();
}

function readPendingDeviceAuthorization(): DeviceAuthorization | undefined {
  const {
    pendingDeviceCode,
    pendingDeviceCodeExpiresAt,
    pendingUserCode,
    pendingVerificationUrl,
  } = readUserConfig();
  if (
    pendingDeviceCode === undefined ||
    pendingDeviceCodeExpiresAt === undefined ||
    pendingUserCode === undefined ||
    pendingVerificationUrl === undefined
  ) {
    return undefined;
  }
  return {
    deviceCode: pendingDeviceCode,
    expiresAt: pendingDeviceCodeExpiresAt,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    userCode: pendingUserCode,
    verificationUrl: pendingVerificationUrl,
  };
}

function writePendingDeviceAuthorization({
  deviceCode,
  expiresAt,
  userCode,
  verificationUrl,
}: DeviceAuthorization): void {
  writeUserConfig({
    ...readUserConfig(),
    pendingDeviceCode: deviceCode,
    pendingDeviceCodeExpiresAt: expiresAt,
    pendingUserCode: userCode,
    pendingVerificationUrl: verificationUrl,
  });
}
