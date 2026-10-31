import { z } from 'zod';
import { defineOptions } from 'zodline';

// zodline answers `--help` and `--version` before any command runs.
// Both options are here only so the help lists them.
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
  version: z.boolean().optional().describe("Print the CLI's version."),
  yes: z
    .boolean()
    .optional()
    .describe('Take every default, ask nothing, confirm nothing.'),
};

export function defineCommandOptions<TShape extends z.ZodRawShape>(
  shape: TShape,
) {
  // The first spread puts the command options first in the help.
  // The last spread overrides a global option of the same name.
  return defineOptions(
    z.object({ ...shape, ...globalOptionsShape, ...shape }),
    { h: 'help', v: 'version', y: 'yes' },
  );
}
