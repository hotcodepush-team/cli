import { readFileSync } from 'node:fs';
import { InvalidParameterError } from './errors.js';

export function readFlagFile(
  filePath: string,
  { fix, parameter }: { fix: string; parameter: string },
): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new InvalidParameterError(
      `The file ${filePath} from ${parameter} cannot be read.`,
      { cause: error, fix },
    );
  }
}
