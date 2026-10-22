/**
 * The text as one single-quoted word of bash or zsh: each single quote in it closes the quote, is escaped and reopens it.
 */
export function quotePosixWord(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}
