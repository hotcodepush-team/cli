import { InvalidParameterError } from './errors.js';

export interface NameValuePair {
  name: string;
  value: string;
}

// The first = splits, since a value such as a base64 token may end in = itself.
export function resolveNameValuePairs(
  pairs: string[] | undefined,
  { flag }: { flag: string },
): NameValuePair[] {
  return (pairs ?? []).map(pair => {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) {
      throw new InvalidParameterError(
        `The value "${pair}" of ${flag} is not a name=value pair.`,
        { fix: 'Pass the name and the value joined by =.' },
      );
    }
    return {
      name: pair.slice(0, separatorIndex),
      value: pair.slice(separatorIndex + 1),
    };
  });
}
