#!/usr/bin/env node
import { PACKAGE_JSON } from './config/consts.js';
import { commandRegistry } from './registry.js';
import { runCli } from './utils/cli.js';

process.exitCode = await runCli(commandRegistry, {
  argv: process.argv.slice(2),
  meta: PACKAGE_JSON,
});
