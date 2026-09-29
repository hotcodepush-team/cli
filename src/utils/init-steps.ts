import type { CliError } from './errors.js';
import type { OutcomeRow } from './outcome.js';

export type StepStatus = 'done' | 'skipped' | 'stopped';

export interface InitStep {
  code?: string;
  manualStep?: string;
  message: string;
  status: StepStatus;
  step: string;
}

/**
 * What a step hands back: its status, the sentence the row prints, and the value the next steps build on.
 */
export interface StepOutcome<TValue> {
  message: string;
  status: 'done' | 'skipped';
  value: TValue;
}

/**
 * The steps of one `init` run in order: a step runs unless an earlier one stopped, and a CLI error inside a step
 * stops it with the error's code and fix as the manual step, so the run reports instead of throwing.
 */
export class InitRun {
  readonly steps: InitStep[] = [];
  private stoppedStep: string | undefined;

  get stoppedCode(): string | undefined {
    return this.steps.find(({ status }) => status === 'stopped')?.code;
  }

  async run<TValue>(
    step: string,
    perform: () => Promise<StepOutcome<TValue>>,
  ): Promise<TValue | undefined> {
    if (this.stoppedStep !== undefined) {
      this.steps.push({
        message: `not run: init stopped at ${this.stoppedStep}`,
        status: 'skipped',
        step,
      });
      return undefined;
    }
    try {
      const { message, status, value } = await perform();
      this.steps.push({ message, status, step });
      return value;
    } catch (error) {
      if (!isCliError(error)) {
        throw error;
      }
      this.steps.push({
        code: error.code,
        manualStep: error.fix ?? error.message,
        message: error.message,
        status: 'stopped',
        step,
      });
      this.stoppedStep = step;
      return undefined;
    }
  }
}

export function resolveStepRows(steps: InitStep[]): OutcomeRow[] {
  return steps.map(({ code, manualStep, message, status, step }) => ({
    label: step,
    manualStep,
    message: code === undefined ? message : `${code} ${message}`,
    status,
  }));
}

function isCliError(error: unknown): error is CliError {
  return (
    error instanceof Error &&
    typeof (error as Partial<CliError>).code === 'string' &&
    typeof (error as Partial<CliError>).exitCode === 'number'
  );
}
