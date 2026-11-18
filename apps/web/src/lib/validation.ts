import type { ZodType } from 'zod';

const HINTS: Record<string, string> = {
  email: 'Introduce un correo electrónico válido.',
  password: 'La contraseña debe tener al menos 8 caracteres.',
  name: 'Escribe tu nombre (máximo 100 caracteres).',
  orgName: 'Escribe el nombre de la organización (máximo 100 caracteres).',
};

export type FieldErrors = Record<string, string>;

/** Validates with a shared Zod schema; returns the parsed data or Spanish per-field hints. */
export function validate<T>(
  schema: ZodType<T>,
  input: unknown,
): { data: T; errors?: undefined } | { data?: undefined; errors: FieldErrors } {
  const result = schema.safeParse(input);
  if (result.success) return { data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    errors[key] ??= HINTS[key] ?? 'Valor no válido.';
  }
  return { errors };
}
