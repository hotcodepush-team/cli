import { z } from 'zod';
import { defineOptions } from 'zodline';

const globalOptionsShape = {
  app: z
    .string()
    .optional()
    .describe(
      'The app, by id or name, when no hotcodepush.json is found or another app is meant.',
    ),
  config: z
    .string()
    .optional()
    .describe(
      'The hotcodepush.json to use, when it is not the nearest one up from the working directory.',
    ),
  // zodline answers --help itself, before a command runs; the option is here for the help to list it
  help: z.boolean().optional().describe('Print this help.'),
  json: z
    .boolean()
    .optional()
    .describe('Print machine output as JSON on stdout and ask nothing.'),
  organization: z
    .string()
    .optional()
    .describe('The organization, by id or name, when you belong to several.'),
  verbose: z.boolean().optional().describe('Print the detail behind an error.'),
  // the command line resolves --version to the version alone; the option is here for the help to list it
  version: z.boolean().optional().describe("Print the CLI's version."),
  yes: z
    .boolean()
    .optional()
    .describe('Take every default, ask nothing, confirm nothing.'),
};

/**
 * The options of a command: its own, then the global ones every command accepts.
 * A command that gives a global option its own meaning names it in its shape, and its description replaces the global one.
 */
export function defineCommandOptions<TShape extends z.ZodRawShape>(
  shape: TShape,
) {
  // the shape spread twice: its options lead the help, and the last spread wins over a global option of the same name
  return defineOptions(
    z.object({ ...shape, ...globalOptionsShape, ...shape }),
    { h: 'help', v: 'version', y: 'yes' },
  );
}
