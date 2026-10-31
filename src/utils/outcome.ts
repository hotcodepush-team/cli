/**
 * One line of a command that reports several outcomes — `init`'s steps, `doctor`'s checks — by the step's or the check's
 * name, `--json`'s snake_case, with the manual step under a failure.
 */
export interface OutcomeRow {
  manualStep?: string;
  message: string;
  name: string;
  status: 'done' | 'failed' | 'ok' | 'skipped' | 'stopped';
}

const STATUS_MARKS: Record<OutcomeRow['status'], string> = {
  done: '✓',
  failed: '✗',
  ok: '✓',
  skipped: '–',
  stopped: '✗',
};

export function printOutcomeRows(rows: OutcomeRow[]): void {
  const labeledRows = rows.map(row => ({
    ...row,
    label: resolveOutcomeLabel(row.name),
  }));
  const labelWidth = Math.max(...labeledRows.map(({ label }) => label.length));
  for (const { label, manualStep, message, status } of labeledRows) {
    console.log(
      `${STATUS_MARKS[status]} ${label.padEnd(labelWidth)}  ${message}`,
    );
    if (manualStep !== undefined) {
      console.log(`${' '.repeat(labelWidth + 4)}${manualStep}`);
    }
  }
}

/**
 * The name in plain words, `sign_in` as `Sign in`.
 */
function resolveOutcomeLabel(name: string): string {
  const words = name.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
