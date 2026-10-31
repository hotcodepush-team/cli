import type { CompletionCommand } from './command-tree.js';
import { quotePosixWord } from './posix-quote.js';

type BuildCaseArm = (
  pattern: string,
  command: CompletionCommand,
  commandWordCount: number,
) => string[];

// The verb arms come first, so `fingerprint diff` matches before `fingerprint`.
export function buildPosixCaseArms(
  commands: CompletionCommand[],
  buildCaseArm: BuildCaseArm,
): string[] {
  const verbArms = commands.flatMap(noun =>
    noun.verbs.map(verb =>
      buildCaseArm(quotePosixWord(`${noun.name} ${verb.name}`), verb, 2),
    ),
  );
  const standaloneArms = commands
    .filter(({ options }) => options.length > 0)
    .map(command =>
      buildCaseArm(`${quotePosixWord(`${command.name} `)}*`, command, 1),
    );
  return [...verbArms, ...standaloneArms].flat();
}
