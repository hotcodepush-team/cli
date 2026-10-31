import type { CompletionCommand } from './command-tree.js';
import { buildPosixCaseArms } from './posix-case-arms.js';
import { quotePosixWord } from './posix-quote.js';

export function buildBashScript(commands: CompletionCommand[]): string {
  return [
    '_hotcodepush() {',
    '  local cur=${COMP_WORDS[COMP_CWORD]} prev=${COMP_WORDS[COMP_CWORD-1]}',
    '  if (( COMP_CWORD == 1 )); then',
    `    ${buildReply(commands.map(({ name }) => name))}`,
    '    return',
    '  fi',
    '  if (( COMP_CWORD == 2 )) && [[ $cur != -* ]]; then',
    '    case ${COMP_WORDS[1]} in',
    ...commands
      .filter(({ verbs }) => verbs.length > 0)
      .map(
        ({ name, verbs }) =>
          `      ${quotePosixWord(name)}) ${buildReply(verbs.map(verb => verb.name))}; return ;;`,
      ),
    '    esac',
    '  fi',
    '  case "${COMP_WORDS[1]} ${COMP_WORDS[2]}" in',
    ...buildPosixCaseArms(commands, buildOptionsArm),
    '  esac',
    '}',
    '',
    'complete -o default -F _hotcodepush hotcodepush',
  ].join('\n');
}

// A command that takes arguments offers its flags only for a word starting with `-`.
// Its arguments fall back to the file names.
function buildOptionsArm(
  pattern: string,
  { hasArguments, options }: CompletionCommand,
): string[] {
  const enumOptions = options.filter(({ choices }) => choices.length > 0);
  const freeValueFlags = options
    .filter(({ choices, hasValue }) => hasValue && choices.length === 0)
    .map(({ name }) => quotePosixWord(`--${name}`));
  const flagReply = buildReply(options.map(({ name }) => `--${name}`));
  return [
    `    ${pattern})`,
    '      case $prev in',
    ...enumOptions.map(
      ({ choices, name }) =>
        `        ${quotePosixWord(`--${name}`)}) ${buildReply(choices)} ;;`,
    ),
    ...(freeValueFlags.length > 0
      ? [`        ${freeValueFlags.join('|')}) ;;`]
      : []),
    `        *) ${hasArguments ? `[[ $cur == -* ]] && ${flagReply}` : flagReply} ;;`,
    '      esac',
    '      ;;',
  ];
}

function buildReply(words: string[]): string {
  return `COMPREPLY=($(compgen -W ${quotePosixWord(words.join(' '))} -- "$cur"))`;
}
