import { z } from 'zod';
import { defineCommand } from 'zodline';
import {
  COMPLETION_SHELLS,
  readCompletionScript,
} from '../utils/completion/script-files.js';
import { InvalidParameterError } from '../utils/errors.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { promptSelect } from '../utils/prompts.js';

// zodline turns an invalid argument into a plain error, which would read as `unexpected`, so the action checks the shell itself
const ShellSchema = z.enum(COMPLETION_SHELLS);

export default defineCommand({
  description:
    'Print the completion script for <shell>, bash, fish or zsh: eval "$(hotcodepush completion <shell>)" loads it from ~/.bashrc, or from ~/.zshrc after compinit, and fish loads it saved as ~/.config/fish/completions/hotcodepush.fish.',
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
    const script = await readCompletionScript(parsedShell.data);
    if (options.json) {
      printJson({ script });
      return;
    }
    console.log(script);
  },
});
