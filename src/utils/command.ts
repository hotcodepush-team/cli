import type { z } from 'zod';
import type { CommandDefinition, OptionsDefinition } from 'zodline';
import { defineCommand as defineZodlineCommand } from 'zodline';

// A command needs a login, a stored session or `HOTCODEPUSH_TOKEN`, unless it says `optional`.
export type Authentication = 'optional' | 'required';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- A narrower type rejects zodline commands with options or args.
export type Command = CommandDefinition<any, any> & {
  authentication: Authentication;
};

export function defineCommand<
  TOptions extends OptionsDefinition<z.ZodObject> | undefined = undefined,
  TArgs extends z.ZodType | undefined = undefined,
>({
  authentication = 'required',
  ...command
}: Parameters<typeof defineZodlineCommand<TOptions, TArgs>>[0] & {
  authentication?: Authentication;
}) {
  return { ...defineZodlineCommand(command), authentication };
}
