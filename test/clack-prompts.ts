import type * as ClackPrompts from '@clack/prompts';
import { vi } from 'vitest';

// The prompts are faked, so a test answers them; the log stays real, so a test reads the diagnostics it prints.
const clackPrompts =
  await vi.importActual<typeof ClackPrompts>('@clack/prompts');

export const clackPromptsMock = {
  ...clackPrompts,
  confirm: vi.fn(),
  isCancel: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
};
