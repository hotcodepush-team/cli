import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { COMPLETION_DIRECTORY_PATH } from '../../config/consts.js';
import type { CommandRegistry } from '../command-registry.js';
import { loadCommands } from '../command-registry.js';
import { buildBashScript } from './bash.js';
import type { CompletionCommand } from './command-tree.js';
import { resolveCommandTree } from './command-tree.js';
import { buildFishScript } from './fish.js';
import { buildZshScript } from './zsh.js';

export const COMPLETION_SHELLS = ['bash', 'fish', 'zsh'] as const;

export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

const SCRIPT_BUILDERS: Record<
  CompletionShell,
  (commands: CompletionCommand[]) => string
> = {
  bash: buildBashScript,
  fish: buildFishScript,
  zsh: buildZshScript,
};

export async function readCompletionScript(
  shell: CompletionShell,
): Promise<string> {
  return readFile(resolveCompletionScriptPath(shell), 'utf8');
}

// The build runs this once, so a shell start loads no command.
export async function writeCompletionScripts(
  commandRegistry: CommandRegistry,
): Promise<void> {
  const commands = resolveCommandTree(
    await loadCommands(commandRegistry, Object.keys(commandRegistry)),
  );
  await mkdir(COMPLETION_DIRECTORY_PATH, { recursive: true });
  await Promise.all(
    COMPLETION_SHELLS.map(shell =>
      writeFile(
        resolveCompletionScriptPath(shell),
        SCRIPT_BUILDERS[shell](commands),
      ),
    ),
  );
}

function resolveCompletionScriptPath(shell: CompletionShell): string {
  return join(COMPLETION_DIRECTORY_PATH, `hotcodepush.${shell}`);
}
