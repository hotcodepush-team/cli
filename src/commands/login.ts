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
  NotLoggedInError,
} from '../utils/errors.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { writeToken } from '../utils/token-store.js';
import { readUserConfig, writeUserConfig } from '../utils/user-config.js';

interface DeviceAuthorization {
  device_code: string;
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
    const deviceAuthorization = resolveResponseData(
      await authClient.device.code({ client_id: CLI_CLIENT_ID }),
    );
    const prompt = resolveDeviceAuthorizationPrompt(deviceAuthorization);
    if (!isInteractive(options)) {
      throw new NotLoggedInError(prompt);
    }
    console.log(
      `Open ${prompt.verificationUrl} and approve the code ${prompt.userCode}.`,
    );
    console.log('Waiting for the approval…');
    openBrowser(prompt.verificationUrl);
    const sessionToken = await fetchApprovedSessionToken(
      authClient,
      deviceAuthorization,
    );
    const { session, user } = await fetchSession(
      createApiAuthClient(sessionToken),
    );
    writeToken(sessionToken);
    writeUserConfig({ ...readUserConfig(), sessionId: session.id });
    console.log(`Logged in as ${user.name} (${user.email}).`);
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
    const { data, error } = await authClient.device.token({
      client_id: CLI_CLIENT_ID,
      device_code,
      grant_type: DEVICE_CODE_GRANT_TYPE,
    });
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

function resolveDeviceAuthorizationPrompt({
  user_code,
  verification_uri_complete,
}: DeviceAuthorization): DeviceAuthorizationPrompt {
  return { userCode: user_code, verificationUrl: verification_uri_complete };
}
