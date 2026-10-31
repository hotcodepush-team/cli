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

export interface StepOutcome<TValue> {
  message: string;
  status: 'done' | 'skipped';
  value: TValue;
}

export interface RunStepOptions {
  dependsOn?: string[];
}

// Any error stops only its own step, so the run reports instead of throwing and independent steps still run.
// An API message without a fix carries the fix itself, so it doubles as the manual step.
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

export function resolveStepRows(steps: InitStep[]): OutcomeRow[] {
  return steps.map(({ manualStep, message, status, step }) => ({
    label: step,
    manualStep: manualStep === message ? undefined : manualStep,
    message,
    status,
  }));
}
