import { vi } from 'vitest';

// The prompts are faked, so a test answers them.
export const promptRenderersMock = {
  confirm: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
};
