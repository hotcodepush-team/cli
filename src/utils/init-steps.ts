import { resolveCliError, resolveSentence } from './error-mapping.js';
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

  get stoppedStep(): string | undefined {
    return this.steps.find(({ status }) => status === 'stopped')?.step;
  }

  async run<TValue>(
    step: string,
    perform: () => Promise<StepOutcome<TValue>>,
    { dependsOn = [] }: RunStepOptions = {},
  ): Promise<TValue | undefined> {
    const unmetStep = dependsOn.find(name => this.unmetSteps.has(name));
    if (unmetStep !== undefined) {
      this.steps.push({
        message: `Waits on the ${unmetStep} step.`,
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
      const messageSentence = resolveSentence(message);
      this.steps.push({
        code,
        manualStep: fix ?? messageSentence,
        message: messageSentence,
        status: 'stopped',
        step,
      });
      this.unmetSteps.add(step);
      return undefined;
    }
  }
}

/**
 * The rows the terminal prints: an API error's message is its manual step too, printed once.
 */
export function resolveStepRows(steps: InitStep[]): OutcomeRow[] {
  return steps.map(({ manualStep, message, status, step }) => ({
    label: step,
    manualStep: manualStep === message ? undefined : manualStep,
    message,
    status,
  }));
}
