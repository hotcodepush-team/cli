/**
 * The one document `--json` puts on stdout, indented for a person reading along.
 */
export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}
