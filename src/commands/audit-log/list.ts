import type { AuditLog } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { resolveTimeBound } from '../../utils/duration.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import {
  fetchApps,
  fetchOrganizationId,
  fetchResourceId,
} from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "List the organization's audit log, newest first, filtered by type, actor, app and time; paying plans only.",
  examples: [
    'hotcodepush audit-log list --type "channel.*" --created-since 7d',
    'hotcodepush audit-log list --app "My App" --actor 4f2c8a1e-6b3d-4e9f-a7c5-2d8b1e6f3a90 --json',
  ],
  options: defineCommandOptions({
    ...paginationShape,
    actor: z.string().optional().describe('The user who acted, by id.'),
    createdSince: z
      .string()
      .optional()
      .describe(
        'The earliest row, inclusive: an ISO 8601 timestamp or a duration ago such as 2h or 7d.',
      ),
    createdUntil: z
      .string()
      .optional()
      .describe(
        'The latest row, inclusive: an ISO 8601 timestamp or a duration ago such as 2h or 7d.',
      ),
    type: z
      .string()
      .optional()
      .describe(
        'The type, such as channel.created, or channel.* for every action on the object.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    // the log is the organization's: --app filters it, and hotcodepush.json's app never does
    const listedAuditLogs = await hotCodePush.organizations.auditLogs.list({
      appId:
        options.app === undefined
          ? undefined
          : await fetchResourceId('app', options.app, () =>
              fetchApps(hotCodePush, organizationId),
            ),
      createdSince: resolveTimeBound(options.createdSince),
      createdUntil: resolveTimeBound(options.createdUntil),
      limit: options.limit,
      offset: options.offset,
      organizationId,
      relations: ['user'],
      type: options.type,
      userId: options.actor,
    });
    const nextOffset = resolveNextOffset(listedAuditLogs.length, options);
    if (options.json) {
      printJson({ auditLogs: listedAuditLogs, nextOffset });
      return;
    }
    printTable({
      emptyText: 'No audit log rows match.',
      headers: ['TIME', 'TYPE', 'ACTOR', 'OBJECT'],
      nextOffset,
      rows: listedAuditLogs.map(auditLog => [
        auditLog.createdAt,
        auditLog.type,
        resolveActorText(auditLog),
        auditLog.objectId ?? '',
      ]),
    });
  },
});

/**
 * Who acted, as the console names them: the user's email while the user is live, their id after, the system without one.
 */
function resolveActorText({ user, userId }: AuditLog): string {
  return user?.email ?? userId ?? 'system';
}
