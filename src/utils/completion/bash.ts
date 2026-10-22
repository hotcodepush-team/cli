import type { CompletionCommand } from './command-tree.js';
import { quotePosixWord } from './posix-quote.js';

/**
 * The bash completion script: the first word from the top-level names, the second from the noun's verbs,
 * then the command's flags and an enum's choices after its flag; a free value falls back to the file names.
 */
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
    ...buildCommandArms(commands),
    '  esac',
    '}',
    '',
    'complete -o default -F _hotcodepush hotcodepush',
  ].join('\n');
}

/**
 * One case arm per runnable command, matched on its first two words: the verbs first, so `fingerprint diff` wins over `fingerprint`.
 */
function buildCommandArms(commands: CompletionCommand[]): string[] {
  const verbArms = commands.flatMap(noun =>
    noun.verbs.map(verb =>
      buildOptionsArm(quotePosixWord(`${noun.name} ${verb.name}`), verb),
    ),
  );
  const standaloneArms = commands
    .filter(({ options }) => options.length > 0)
    .map(command =>
      buildOptionsArm(`${quotePosixWord(`${command.name} `)}*`, command),
    );
  return [...verbArms, ...standaloneArms].flat();
}

/**
 * The arm that completes a command's options: an enum's choices after its flag, nothing after a free value, otherwise the flags,
 * which a command that takes arguments offers only for a word starting with `-`, leaving its arguments to the file names.
 */
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
