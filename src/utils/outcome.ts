/**
 * One line of a command that reports several outcomes — `init`'s steps, `doctor`'s checks — with the manual step under a failure.
 */
export interface OutcomeRow {
  label: string;
  manualStep?: string;
  message: string;
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
  const labelWidth = Math.max(...rows.map(({ label }) => label.length));
  for (const row of rows) {
    console.log(
      `${STATUS_MARKS[row.status]} ${row.label.padEnd(labelWidth)}  ${row.message}`,
    );
    if (row.manualStep !== undefined) {
      console.log(`${' '.repeat(labelWidth + 4)}${row.manualStep}`);
    }
  }
}
