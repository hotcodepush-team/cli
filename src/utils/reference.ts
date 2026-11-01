import { z } from 'zod';

const ID_SCHEMA = z.guid();

const NUMBER_PATTERN = /^\d+$/;

export function isId(reference: string): boolean {
  return ID_SCHEMA.safeParse(reference).success;
}

export function isNumber(reference: string): boolean {
  return NUMBER_PATTERN.test(reference);
}
