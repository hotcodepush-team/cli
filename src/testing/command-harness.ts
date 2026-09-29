import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import type { ProjectConfig } from '../utils/project-config.js';
import { writeUserConfig } from '../utils/user-config.js';

/**
 * What the fake API answers per route, keyed by method and path, `GET /v1/organizations`,
 * or with the query where it matters, `GET /v1/organizations?limit=2`; any other request is the API's 404.
 */
export type Routes = Record<string, (request: Request) => Response>;

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

export function stubInteractiveTerminal(): void {
  process.stdin.isTTY = true;
  process.stdout.isTTY = true;
}

/**
 * What every command test runs on, fresh per test: the API faked behind the global fetch, a token in the environment,
 * a terminal that is not interactive until a test says so, and the output captured.
 */
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
    vi.stubEnv('CI', undefined);
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

function respondFromRoutes(routes: Routes, request: Request): Response {
  const url = new URL(request.url);
  const respond =
    routes[`${request.method} ${url.pathname}${url.search}`] ??
    routes[`${request.method} ${url.pathname}`];
  return respond
    ? respond(request)
    : respondWithApiError(404, 'E_NOT_FOUND', 'The resource does not exist.');
}
