// Each single quote closes the quote, is escaped and reopens it.
export function quotePosixWord(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}
