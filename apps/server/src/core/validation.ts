import type { z } from 'zod';
import { AppError } from './errors.js';

// Request validation through a shared zod schema. Failures carry only field paths, never values.
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'invalid request', {
      fields: result.error.issues.map((issue) => issue.path.join('.')),
    });
  }
  return result.data;
}
