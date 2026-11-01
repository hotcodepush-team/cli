import type { CompletionCommand } from './command-tree.js';
import { quotePosixWord } from './posix-quote.js';

// The pattern matches the command words, and commandWordCount says how many there are.
export interface CaseArmPosition {
  commandWordCount: number;
  pattern: string;
}

type BuildCaseArm = (
  command: CompletionCommand,
  position: CaseArmPosition,
) => string[];

// The verb arms come first, so `fingerprint diff` matches before `fingerprint`.
export function buildPosixCaseArms(
  commands: CompletionCommand[],
  buildCaseArm: BuildCaseArm,
): string[] {
  const verbArms = commands.flatMap(noun =>
    noun.verbs.map(verb =>
      buildCaseArm(verb, {
        commandWordCount: 2,
        pattern: quotePosixWord(`${noun.name} ${verb.name}`),
      }),
    ),
  );
  const standaloneArms = commands
    .filter(({ options }) => options.length > 0)
    .map(command =>
      buildCaseArm(command, {
        commandWordCount: 1,
        pattern: `${quotePosixWord(`${command.name} `)}*`,
      }),
    );
  return [...verbArms, ...standaloneArms].flat();
}
