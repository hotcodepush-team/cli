import { describe, expect, it, vi } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  AUDIT_LOG,
  DEMO_APP,
  RUNNER_USER,
} from '../../../test/fixtures.js';
import auditLogListCommand from './list.js';

const AUDIT_LOGS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/audit-logs`;

const ACTOR_ID = '4f2c8a1e-6b3d-4e9f-a7c5-2d8b1e6f3a90';

describe('audit-log list', () => {
  const harness = useCommandHarness();

  function readListUrl(): URL | undefined {
    return harness.requests
      .map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === AUDIT_LOGS_PATH);
  }

  it('should list the rows with their time, type, actor and object', async () => {
    harness.routes[`GET ${AUDIT_LOGS_PATH}`] = () =>
      Response.json([
        {
          ...AUDIT_LOG,
          user: {
            email: RUNNER_USER.email,
            id: RUNNER_USER.id,
            name: RUNNER_USER.name,
          },
        },
        { ...AUDIT_LOG, type: 'channel.deleted' },
        { ...AUDIT_LOG, objectId: null, type: 'bundle.expired', userId: null },
      ]);

    await auditLogListCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(readListUrl()?.searchParams.get('relations')).toBe('user');
    expect(harness.readLines()).toEqual([
      'TIME                      TYPE             ACTOR             OBJECT',
      `2026-09-10T08:00:00.000Z  channel.created  anna@example.com  ${AUDIT_LOG.objectId}`,
      `2026-09-10T08:00:00.000Z  channel.deleted  user-1            ${AUDIT_LOG.objectId}`,
      '2026-09-10T08:00:00.000Z  bundle.expired   system',
    ]);
  });

  it('should send every filter, the app by its id among the apps of the organization and a duration as the timestamp it reaches back to', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-10T12:00:00.000Z') });
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}/apps`] = () =>
      Response.json([DEMO_APP]);
    harness.routes[`GET ${AUDIT_LOGS_PATH}`] = () => Response.json([]);

    await auditLogListCommand.action(
      {
        actor: ACTOR_ID,
        app: DEMO_APP.name,
        createdSince: '7d',
        createdUntil: '2026-09-10T00:00:00.000Z',
        organization: ACME_ORGANIZATION.id,
        type: 'channel.*',
      },
      undefined,
    );
    vi.useRealTimers();

    expect(Object.fromEntries(readListUrl()?.searchParams ?? [])).toEqual({
      appId: DEMO_APP.id,
      createdSince: '2026-09-03T12:00:00.000Z',
      createdUntil: '2026-09-10T00:00:00.000Z',
      relations: 'user',
      type: 'channel.*',
      userId: ACTOR_ID,
    });
    expect(harness.readLines()).toEqual(['No audit log rows match.']);
  });

  it("should leave the app filter out when --app is missing, hotcodepush.json's app included", async () => {
    const configPath = harness.writeProjectConfig({
      appId: DEMO_APP.id,
      channel: 'production',
    });
    harness.routes[`GET ${AUDIT_LOGS_PATH}`] = () => Response.json([]);

    await auditLogListCommand.action(
      { config: configPath, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(readListUrl()?.searchParams.has('appId')).toBe(false);
  });

  it('should print JSON with the next offset', async () => {
    harness.routes[`GET ${AUDIT_LOGS_PATH}`] = () => Response.json([AUDIT_LOG]);

    await auditLogListCommand.action(
      { json: true, limit: 1, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(readListUrl()?.searchParams.get('limit')).toBe('1');
    expect(harness.readJson()).toEqual({
      auditLogs: [AUDIT_LOG],
      nextOffset: 1,
    });
  });
});
