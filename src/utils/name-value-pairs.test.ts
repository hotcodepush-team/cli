import { describe, expect, it } from 'vitest';
import { InvalidParameterError } from './errors.js';
import { resolveNameValuePairs } from './name-value-pairs.js';

describe('resolveNameValuePairs', () => {
  it('should split each pair at its first =, so a value may hold = itself', () => {
    expect(
      resolveNameValuePairs(['Authorization=Bearer dG9rZW4='], {
        flag: '--header',
      }),
    ).toEqual([{ name: 'Authorization', value: 'Bearer dG9rZW4=' }]);
  });

  it('should throw `invalid_parameter` naming the flag when a pair has no =', () => {
    expect(() =>
      resolveNameValuePairs(['Authorization'], { flag: '--header' }),
    ).toThrow(
      new InvalidParameterError(
        'The value "Authorization" of --header is not a name=value pair.',
        { fix: 'Pass the name and the value joined by =.' },
      ),
    );
  });
});
