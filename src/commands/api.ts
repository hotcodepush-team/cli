import { text } from 'node:stream/consumers';
import type { HotCodePush, RequestOptions } from '@hotcodepush/node';
import { z } from 'zod';
import type { AppOptions } from '../resources/apps.js';
import { fetchAppId } from '../resources/apps.js';
import { fetchOrganizationId } from '../resources/organizations.js';
import { createApiClient } from '../utils/api-client.js';
import { defineCommand } from '../utils/command.js';
import { InvalidParameterError } from '../utils/errors.js';
import { readFlagFile } from '../utils/flag-file.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { resolveJsonSyntaxProblem } from '../utils/json-file.js';
import { printJson } from '../utils/output.js';
import { readProjectConfig } from '../utils/project-config.js';
import { promptText } from '../utils/prompts.js';
import { assertNoSurplusArguments } from '../utils/surplus-arguments.js';

interface BodyOptions {
  bodyPath?: string;
  method?: Method;
}

type Method = RequestOptions['method'];

type Placeholder = keyof typeof PLACEHOLDER_VALUE_FETCHERS;

interface PlaceholderOptions extends AppOptions {
  config?: string;
}

const BODY_FIX =
  'Pass a file that holds one JSON value, or - to read it from stdin.';

const METHODS = [
  'DELETE',
  'GET',
  'PATCH',
  'POST',
  'PUT',
] as const satisfies readonly Method[];

// Matches a placeholder as the API reference writes it, such as {appId}.
const PLACEHOLDER_PATTERN = /\{\w+\}/g;

const PLACEHOLDER_VALUE_FETCHERS = {
  '{appId}': (hotCodePush: HotCodePush, options: PlaceholderOptions) =>
    fetchAppId(hotCodePush, {
      options,
      projectConfig: readProjectConfig(options.config),
    }),
  '{organizationId}': fetchOrganizationId,
};

const STDIN_BODY_PATH = '-';

export default defineCommand({
  description:
    'Send one request to the HotCodePush API and print the response body. <path> is a path of the API, such as /v1/apps/{appId}/channels, and may carry a query string. Its leading slash may be left out. The CLI fills {appId} and {organizationId} from hotcodepush.json, --app and --organization.',
  examples: [
    "hotcodepush api '/v1/apps/{appId}/channels?limit=100'",
    "hotcodepush api '/v1/apps/{appId}/channels' --body-path channel.json",
  ],
  args: z.array(z.string()),
  options: defineCommandOptions({
    bodyPath: z
      .string()
      .optional()
      .describe('The JSON file to send as the request body, or - for stdin.'),
    json: z
      .boolean()
      .optional()
      .describe(
        'Print an error as JSON on stdout. The response body prints the same with and without it.',
      ),
    method: z
      .enum(METHODS)
      .optional()
      .describe(
        'The HTTP method, DELETE, GET, PATCH, POST or PUT. Defaults to GET, or to POST when --body-path is passed.',
      ),
  }),
  action: async (options, args) => {
    assertNoSurplusArguments(args, {
      maximum: 1,
      usage: 'The api command takes one path, <path>.',
    });
    assertBodyAllowed(options);
    const path =
      args[0] ??
      (await promptText(options, {
        flag: '<path>',
        message: 'Which path of the API?',
      }));
    const hotCodePush = createApiClient();
    const requestPath = await fetchRequestPath(hotCodePush, {
      options,
      path: resolvePathWithLeadingSlash(path),
    });
    const body = await readBody(options);
    const response = await hotCodePush.request({
      body,
      method: resolveMethod(options),
      path: requestPath,
    });
    await printResponse(response);
  },
});

function assertBodyAllowed({ bodyPath, method }: BodyOptions): void {
  if (method === 'GET' && bodyPath !== undefined) {
    throw new InvalidParameterError(
      'A GET request sends no body, so --method GET and --body-path cannot be passed together.',
      { fix: 'Leave out --body-path, or pass the method that takes the body.' },
    );
  }
}

function assertKnownPlaceholders(
  placeholders: string[],
): asserts placeholders is Placeholder[] {
  const unknownPlaceholder = placeholders.find(
    placeholder => !Object.hasOwn(PLACEHOLDER_VALUE_FETCHERS, placeholder),
  );
  if (unknownPlaceholder !== undefined) {
    throw new InvalidParameterError(
      `The CLI cannot fill ${unknownPlaceholder} in the path.`,
      {
        fix: 'Write the id in its place. The CLI fills {appId} and {organizationId} alone.',
      },
    );
  }
}

async function fetchRequestPath(
  hotCodePush: HotCodePush,
  { options, path }: { options: PlaceholderOptions; path: string },
): Promise<string> {
  const placeholders = [...new Set(path.match(PLACEHOLDER_PATTERN))];
  assertKnownPlaceholders(placeholders);
  let requestPath = path;
  for (const placeholder of placeholders) {
    const value = await PLACEHOLDER_VALUE_FETCHERS[placeholder](
      hotCodePush,
      options,
    );
    requestPath = requestPath.replaceAll(placeholder, value);
  }
  return requestPath;
}

function isJsonResponse(response: Response): boolean {
  return (
    response.headers
      .get('Content-Type')
      ?.toLowerCase()
      .startsWith('application/json') ?? false
  );
}

function parseBody(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new InvalidParameterError(
      `The body from --body-path is not valid JSON. ${resolveJsonSyntaxProblem(error)}.`,
      { fix: BODY_FIX },
    );
  }
}

// An answer that names JSON and holds none, a proxy's error page for example, is no JSON to print.
function parseResponseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

async function printResponse(response: Response): Promise<void> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) {
    return;
  }
  const json = isJsonResponse(response) ? parseResponseJson(bytes) : undefined;
  if (json === undefined) {
    process.stdout.write(bytes);
    return;
  }
  printJson(json);
}

async function readBody({ bodyPath }: BodyOptions): Promise<unknown> {
  if (bodyPath === undefined) {
    return undefined;
  }
  const bodyText =
    bodyPath === STDIN_BODY_PATH
      ? await text(process.stdin)
      : readFlagFile(bodyPath, { fix: BODY_FIX, parameter: '--body-path' });
  return parseBody(bodyText);
}

function resolveMethod({ bodyPath, method }: BodyOptions): Method {
  return method ?? (bodyPath === undefined ? 'GET' : 'POST');
}

// Git Bash on Windows turns an argument with a leading slash into a file path, so the path may come without the slash.
function resolvePathWithLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}
