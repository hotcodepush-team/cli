import { z } from 'zod';
import { defineCommand } from 'zodline';
import { commandRegistry } from '../registry.js';
import { loadCommands } from '../utils/command-registry.js';
import { buildBashScript } from '../utils/completion/bash.js';
import type { CompletionCommand } from '../utils/completion/command-tree.js';
import { resolveCommandTree } from '../utils/completion/command-tree.js';
import { buildFishScript } from '../utils/completion/fish.js';
import { buildZshScript } from '../utils/completion/zsh.js';
import { InvalidParameterError } from '../utils/errors.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { promptSelect } from '../utils/prompts.js';

// zodline turns an invalid argument into a plain error, which would read as E_UNEXPECTED, so the action checks the shell itself
const ShellSchema = z.enum(['bash', 'fish', 'zsh']);

const SCRIPT_BUILDERS: Record<
  z.infer<typeof ShellSchema>,
  (commands: CompletionCommand[]) => string
> = {
  bash: buildBashScript,
  fish: buildFishScript,
  zsh: buildZshScript,
};

export default defineCommand({
  description:
    'Print the completion script for <shell>, bash, fish or zsh; load it with eval "$(hotcodepush completion <shell>)" in ~/.bashrc or ~/.zshrc.',
  examples: [
    'eval "$(hotcodepush completion zsh)"',
    'hotcodepush completion fish > ~/.config/fish/completions/hotcodepush.fish',
  ],
  args: z.array(z.string()),
  options: defineCommandOptions({}),
  action: async (options, args) => {
    if (args.length > 1) {
      throw new InvalidParameterError(
        `The completion command takes one shell, <shell>. It does not take ${args.slice(1).join(' ')}.`,
      );
    }
    const shell =
      args[0] ??
      (await promptSelect(
        '<shell>',
        'Which shell is the completion script for?',
        ShellSchema.options.map(value => ({ label: value, value })),
        options,
      ));
    const parsedShell = ShellSchema.safeParse(shell);
    if (!parsedShell.success) {
      throw new InvalidParameterError(
        `The shell ${shell} has no completion script.`,
        'Pass bash, fish or zsh as <shell>.',
      );
    }
    const loadedCommands = await loadCommands(
      commandRegistry,
      Object.keys(commandRegistry),
    );
    const script = SCRIPT_BUILDERS[parsedShell.data](
      resolveCommandTree(loadedCommands),
    );
    if (options.json) {
      printJson({ script });
      return;
    }
    console.log(script);
  },
});
