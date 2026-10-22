#!/usr/bin/env node
import { PACKAGE_JSON } from './config/consts.js';
import { commandRegistry } from './registry.js';
import { runCli } from './utils/cli.js';

process.exitCode = await runCli(
  commandRegistry,
  process.argv.slice(2),
  PACKAGE_JSON,
);
