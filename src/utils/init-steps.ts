import { resolveCliError } from './error-mapping.js';
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
 * What a step needs from the ones before it: a step whose need stopped, or waits itself, is skipped and says so.
 */
export interface RunStepOptions {
  dependsOn?: string[];
}

/**
 * The steps of one `init` run in order: a step runs unless one it depends on did not, and any error inside a step,
 * the API's and an unreachable network's included, stops it with the error's code and its fix, or the API's message
 * that carries the fix, as the manual step, so the run reports instead of throwing and the independent steps still run.
 */
export class InitRun {
  readonly steps: InitStep[] = [];
  private readonly unmetSteps = new Set<string>();

  get stoppedCode(): string | undefined {
    return this.steps.find(({ status }) => status === 'stopped')?.code;
  }

  async run<TValue>(
    step: string,
    perform: () => Promise<StepOutcome<TValue>>,
    { dependsOn = [] }: RunStepOptions = {},
  ): Promise<TValue | undefined> {
    const unmetStep = dependsOn.find(name => this.unmetSteps.has(name));
    if (unmetStep !== undefined) {
      this.steps.push({
        message: `waits on the ${unmetStep} step`,
        status: 'skipped',
        step,
      });
      this.unmetSteps.add(step);
      return undefined;
    }
    try {
      const { message, status, value } = await perform();
      this.steps.push({ message, status, step });
      return value;
    } catch (error) {
      const { code, fix, message } = resolveCliError(error);
      this.steps.push({
        code,
        manualStep: fix ?? message,
        message,
        status: 'stopped',
        step,
      });
      this.unmetSteps.add(step);
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
