#!/usr/bin/env node
import { createRequire } from 'node:module';
import type { CliMeta } from './utils/cli.js';
import { runCli } from './utils/cli.js';
import type { CommandRegistry } from './utils/command-registry.js';

const packageJson: CliMeta = createRequire(import.meta.url)('../package.json');

const commandRegistry: CommandRegistry = {};

process.exitCode = await runCli(
  commandRegistry,
  process.argv.slice(2),
  packageJson,
);
