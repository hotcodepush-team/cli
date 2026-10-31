import { z } from 'zod';

// A bare flag arrives as true and `--protected false` as a string, so both forms are accepted.
export const booleanFlagSchema = z.union([z.boolean(), z.stringbool()]);
