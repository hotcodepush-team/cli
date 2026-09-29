#!/usr/bin/env node
import { PACKAGE_JSON } from './config/consts.js';
import { runCli } from './utils/cli.js';
import type { CommandRegistry } from './utils/command-registry.js';

const commandRegistry: CommandRegistry = {
  'app create': () => import('./commands/app/create.js'),
  'app delete': () => import('./commands/app/delete.js'),
  'app get': () => import('./commands/app/get.js'),
  'app list': () => import('./commands/app/list.js'),
  'app transfer': () => import('./commands/app/transfer.js'),
  'app update': () => import('./commands/app/update.js'),
  'channel create': () => import('./commands/channel/create.js'),
  'channel delete': () => import('./commands/channel/delete.js'),
  'channel get': () => import('./commands/channel/get.js'),
  'channel list': () => import('./commands/channel/list.js'),
  'channel pause': () => import('./commands/channel/pause.js'),
  'channel resume': () => import('./commands/channel/resume.js'),
  'channel update': () => import('./commands/channel/update.js'),
  'login': () => import('./commands/login.js'),
  'logout': () => import('./commands/logout.js'),
  'organization create': () => import('./commands/organization/create.js'),
  'organization delete': () => import('./commands/organization/delete.js'),
  'organization get': () => import('./commands/organization/get.js'),
  'organization list': () => import('./commands/organization/list.js'),
  'organization update': () => import('./commands/organization/update.js'),
  'whoami': () => import('./commands/whoami.js'),
};

process.exitCode = await runCli(
  commandRegistry,
  process.argv.slice(2),
  PACKAGE_JSON,
);
