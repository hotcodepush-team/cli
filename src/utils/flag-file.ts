import { readFileSync } from 'node:fs';
import { InvalidParameterError } from './errors.js';

export function readFlagFile(
  filePath: string,
  { fix, flag }: { fix: string; flag: string },
): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new InvalidParameterError(
      `The file ${filePath} from ${flag} cannot be read.`,
      { cause: error, fix },
    );
  }
}
