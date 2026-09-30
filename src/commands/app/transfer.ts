import type { App, Organization } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { confirmConsequence } from '../../utils/prompts.js';
import {
  fetchAppId,
  fetchOrganizations,
  fetchResourceId,
  promptResourceId,
} from '../../utils/resource-resolution.js';

interface TargetOrganizationOptions extends InteractivityOptions {
  organization?: string;
}

export default defineCommand({
  description:
    'Move an app to the organization --organization names, one you are an Admin of.',
  examples: [
    'hotcodepush app transfer --organization Globex',
    'hotcodepush app transfer --app "My App" --organization Globex --yes --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    // --organization names the target here, so an app's name is looked up in every organization of the user's
    const appId = await fetchAppId(
      hotCodePush,
      { ...options, organization: undefined },
      readProjectConfig(options.config),
    );
    const [fetchedApp, fetchedOrganizations] = await Promise.all([
      hotCodePush.apps.get({ appId }),
      fetchOrganizations(hotCodePush),
    ]);
    const targetOrganizationId = await pickTargetOrganizationId(
      fetchedApp,
      fetchedOrganizations,
      options,
    );
    const sourceOrganizationName = resolveOrganizationName(
      fetchedOrganizations,
      fetchedApp.organizationId,
    );
    const targetOrganizationName = resolveOrganizationName(
      fetchedOrganizations,
      targetOrganizationId,
    );
    const isConfirmed = await confirmConsequence(
      `moves app ${fetchedApp.name} from organization ${sourceOrganizationName} to organization ${targetOrganizationName}`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const transferredApp = await hotCodePush.apps.transfer({
      appId,
      organizationId: targetOrganizationId,
    });
    if (options.json) {
      printJson(transferredApp);
    } else {
      console.log(
        `Transferred app ${transferredApp.name} (${transferredApp.id}) to organization ${targetOrganizationName}.`,
      );
    }
  },
});

/**
 * `--organization` by id or name, otherwise a picker of the user's other organizations when interactive.
 */
function pickTargetOrganizationId(
  app: App,
  organizations: Organization[],
  options: TargetOrganizationOptions,
): Promise<string> {
  if (options.organization === undefined) {
    return promptResourceId(
      'organization',
      organizations.filter(({ id }) => id !== app.organizationId),
      options,
    );
  }
  return fetchResourceId(
    'organization',
    options.organization,
    async () => organizations,
  );
}

/**
 * The organization's name for the consequence, its id where the user's organizations lack it.
 */
function resolveOrganizationName(
  organizations: Organization[],
  organizationId: string,
): string {
  return (
    organizations.find(({ id }) => id === organizationId)?.name ??
    organizationId
  );
}
