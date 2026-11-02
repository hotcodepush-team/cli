import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../test/command-harness.js';
import { promptRenderersMock } from '../../test/prompt-renderers.js';
import { MissingParameterError } from './errors.js';
import { promptSelect } from './prompts.js';

vi.mock('./prompt-renderers.js', () => promptRenderersMock);

describe('promptSelect', () => {
  useCommandHarness();

  it('should fail with the flag when the prompt is cancelled', async () => {
    stubInteractiveTerminal();
    promptRenderersMock.select.mockResolvedValue(Symbol('cancel'));

    await expect(
      promptSelect(
        {},
        {
          choices: [{ label: 'Expo', value: 'expo' }],
          flag: '--framework',
          message: 'Which framework?',
        },
      ),
    ).rejects.toThrow(MissingParameterError);
  });
});
