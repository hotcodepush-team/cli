import { describe, expect, it } from 'vitest';
import { commandRegistry } from './registry.js';
import { loadCommands } from './utils/command-registry.js';

// The commands that run without a login: the login pair, the shell and project helpers, the checks and the build step.
const COMMANDS_WITHOUT_LOGIN = [
  'binary create',
  'completion',
  'doctor',
  'fingerprint',
  'fingerprint diff',
  'init',
  'login',
  'logout',
  'resource-file write',
];

describe('commandRegistry', () => {
  it('should leave authentication optional for the commands that run without a login and require it everywhere else', async () => {
    const commands = await loadCommands(
      commandRegistry,
      Object.keys(commandRegistry),
    );

    const optionalCommandNames = Object.entries(commands)
      .filter(([, command]) => command.authentication === 'optional')
      .map(([name]) => name);
    expect(optionalCommandNames).toEqual(COMMANDS_WITHOUT_LOGIN);
  });
});
