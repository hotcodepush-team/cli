import { z } from 'zod';

// A flag without a value arrives as true and `--protected false` as a string, so both forms set the field
export const booleanFlagSchema = z.union([z.boolean(), z.stringbool()]);
