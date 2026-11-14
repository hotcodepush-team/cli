import { z } from 'zod';
import { defineCommand } from '../utils/command.js';
import {
  COMPLETION_SHELLS,
  readCompletionScript,
} from '../utils/completion/script-files.js';
import { InvalidParameterError } from '../utils/errors.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { promptSelect } from '../utils/prompts.js';
import { assertNoSurplusArguments } from '../utils/surplus-arguments.js';

// zodline reports an invalid argument as a plain error that would read as `unexpected`.
// So the action checks the shell itself.
const ShellSchema = z.enum(COMPLETION_SHELLS);

export default defineCommand({
  description:
    'Print the completion script for <shell>, bash, fish or zsh: eval "$(hotcodepush completion <shell>)" loads it from ~/.bashrc, or from ~/.zshrc after compinit, and fish loads it saved as ~/.config/fish/completions/hotcodepush.fish.',
  authentication: 'optional',
  examples: [
    'eval "$(hotcodepush completion zsh)"',
    'hotcodepush completion fish > ~/.config/fish/completions/hotcodepush.fish',
  ],
  args: z.array(z.string()),
  options: defineCommandOptions({}),
  action: async (options, args) => {
    assertNoSurplusArguments(args, {
      maximum: 1,
      usage: 'The completion command takes one shell, <shell>.',
    });
    const shell =
      args[0] ??
      (await promptSelect(options, {
        choices: ShellSchema.options.map(value => ({ label: value, value })),
        flag: '<shell>',
        message: 'Which shell is the completion script for?',
      }));
    const parsedShell = ShellSchema.safeParse(shell);
    if (!parsedShell.success) {
      throw new InvalidParameterError(
        `The shell ${shell} has no completion script.`,
        { fix: 'Pass bash, fish or zsh as <shell>.' },
      );
    }
    const script = await readCompletionScript(parsedShell.data);
    if (options.json) {
      printJson({ script });
      return;
    }
    console.log(script);
  },
});
