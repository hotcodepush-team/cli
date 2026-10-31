import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import type { ProjectConfig } from '../src/utils/project-config.js';
import { readUserConfig, writeUserConfig } from '../src/utils/user-config.js';

// Keyed by method and path, with the query where it matters, such as `GET /v1/organizations?limit=2`.
// Any other request gets a 404.
export type Routes = Record<
  string,
  (request: Request) => Promise<Response> | Response
>;

export interface CommandHarness {
  readJson: () => unknown;
  readLines: () => string[];
  requests: Request[];
  routes: Routes;
  writeProjectConfig: (projectConfig: ProjectConfig) => string;
}

export const API_URL = 'https://api.example.com';

export const TOKEN = 'session-token-1';

const originalStdinIsTty = process.stdin.isTTY;
const originalStdoutIsTty = process.stdout.isTTY;

export function respondWithApiError(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json({ code, details: null, message }, { status });
}

// A session stored in `config.json` instead of the environment token, which the CLI calls logged in.
export function useStoredSession(): void {
  vi.stubEnv('HOTCODEPUSH_TOKEN', '');
  writeUserConfig({ ...readUserConfig(), token: TOKEN });
}

export function stubInteractiveTerminal(): void {
  process.stdin.isTTY = true;
  process.stdout.isTTY = true;
}

export function useCommandHarness(): CommandHarness {
  let temporaryDirectoryPath = '';
  const harness: CommandHarness = {
    readJson: () => undefined,
    readLines: () => [],
    requests: [],
    routes: {},
    writeProjectConfig: projectConfig => {
      const filePath = join(temporaryDirectoryPath, 'hotcodepush.json');
      writeFileSync(filePath, JSON.stringify(projectConfig));
      return filePath;
    },
  };
  beforeEach(() => {
    temporaryDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-'));
    vi.stubEnv('APPDATA', temporaryDirectoryPath);
    vi.stubEnv('CI', undefined);
    // The update check would ask the real npm registry, not the faked API.
    vi.stubEnv('HOTCODEPUSH_UPDATE_NOTICE_DISABLED', '1');
    vi.stubEnv('HOTCODEPUSH_SIGNING_KEY', undefined);
    vi.stubEnv('HOTCODEPUSH_TOKEN', TOKEN);
    vi.stubEnv('XDG_CONFIG_HOME', temporaryDirectoryPath);
    writeUserConfig({ apiUrl: API_URL });
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    harness.requests = [];
    harness.routes = {};
    vi.stubGlobal(
      'fetch',
      async (input: Request | string | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        harness.requests.push(request.clone());
        return respondFromRoutes(harness.routes, request);
      },
    );
    const consoleLog = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    harness.readJson = () =>
      JSON.parse(stdoutWrite.mock.calls.map(([chunk]) => chunk).join(''));
    harness.readLines = () =>
      consoleLog.mock.calls.map(values => values.join(' '));
  });
  afterEach(() => {
    process.stdin.isTTY = originalStdinIsTty;
    process.stdout.isTTY = originalStdoutIsTty;
    vi.unstubAllGlobals();
    rmSync(temporaryDirectoryPath, { force: true, recursive: true });
  });
  return harness;
}

function respondFromRoutes(
  routes: Routes,
  request: Request,
): Promise<Response> | Response {
  const url = new URL(request.url);
  const respond =
    routes[`${request.method} ${url.pathname}${url.search}`] ??
    routes[`${request.method} ${url.pathname}`];
  return respond
    ? respond(request)
    : respondWithApiError(404, 'not_found', 'The resource does not exist.');
}
