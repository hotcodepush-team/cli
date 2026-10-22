import { spawnSync } from 'node:child_process';
import { select } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../test/command-harness.js';
import { commandRegistry } from '../registry.js';
import {
  InvalidParameterError,
  MissingParameterError,
} from '../utils/errors.js';
import completionCommand from './completion.js';

vi.mock('@clack/prompts');

describe('completion', () => {
  const harness = useCommandHarness();

  async function printScript(shell: string): Promise<string> {
    await completionCommand.action({}, [shell]);
    return harness.readLines().join('\n');
  }

  it.each(['bash', 'fish', 'zsh'])(
    'should print a %s script that names every registered command',
    async shell => {
      const script = await printScript(shell);

      for (const commandName of Object.keys(commandRegistry)) {
        expect(script).toContain(commandName);
      }
    },
  );

  it.skipIf(!isShellAvailable('bash'))(
    'should print a bash script that bash parses',
    async () => {
      const script = await printScript('bash');

      expect(spawnSync('bash', ['-n'], { input: script }).status).toBe(0);
    },
  );

  it.skipIf(!isShellAvailable('zsh'))(
    'should print a zsh script that zsh parses',
    async () => {
      const script = await printScript('zsh');

      expect(spawnSync('zsh', ['-n'], { input: script }).status).toBe(0);
    },
  );

  it('should print the script as JSON when --json is passed', async () => {
    await completionCommand.action({ json: true }, ['fish']);

    expect(harness.readJson()).toEqual({
      script: expect.stringContaining('complete -c hotcodepush'),
    });
  });

  it('should ask for the shell when none is given and the terminal is interactive', async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue('zsh');

    await completionCommand.action({}, []);

    expect(harness.readLines()[0]).toMatch(/^#compdef hotcodepush\n/);
  });

  it('should stop with E_MISSING_PARAMETER when no shell is given and nobody can be asked', async () => {
    await expect(completionCommand.action({}, [])).rejects.toBeInstanceOf(
      MissingParameterError,
    );
  });

  it('should refuse a shell without a completion script', async () => {
    await expect(completionCommand.action({}, ['tcsh'])).rejects.toBeInstanceOf(
      InvalidParameterError,
    );
  });

  it('should refuse a second argument', async () => {
    await expect(
      completionCommand.action({}, ['zsh', 'bash']),
    ).rejects.toBeInstanceOf(InvalidParameterError);
  });
});

function isShellAvailable(shell: string): boolean {
  return spawnSync(shell, ['-c', 'exit 0']).status === 0;
}
