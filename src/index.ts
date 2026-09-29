#!/usr/bin/env node
import { PACKAGE_JSON } from './config/consts.js';
import { runCli } from './utils/cli.js';
import type { CommandRegistry } from './utils/command-registry.js';

const commandRegistry: CommandRegistry = {
  login: () => import('./commands/login.js'),
  logout: () => import('./commands/logout.js'),
  whoami: () => import('./commands/whoami.js'),
};

process.exitCode = await runCli(
  commandRegistry,
  process.argv.slice(2),
  PACKAGE_JSON,
);
