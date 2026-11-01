import { FormErrors } from '@mantine/form';

import { EnvironmentFieldSchema, EnvironmentValue, GameCatalogType } from '../../../Api/GameServer';

export type FieldSchemas = Record<string, EnvironmentFieldSchema>;
export type EnvironmentValues = Record<string, EnvironmentValue>;

export const envPath = (fieldName: string) => `environment.${fieldName}`;

export function allFields(game: GameCatalogType | null | undefined): FieldSchemas {
  return game ? { ...game.common_fields, ...game.fields } : {};
}

/** Form values for a game: `saved` values where present, otherwise schema defaults. */
export function initialEnvironment(fields: FieldSchemas, saved: EnvironmentValues = {}): EnvironmentValues {
  return Object.fromEntries(
    Object.entries(fields).map(([key, def]) => [
      key,
      saved[key] ?? def.default ?? (def.type === 'boolean' ? false : ''),
    ])
  );
}

export function isEmpty(value: EnvironmentValue | undefined): boolean {
  return value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * Mirrors the backend rules in api/app/internal/config.py so users get inline
 * errors before submitting. The backend remains the source of truth.
 */
export function validateEnvironment(environment: EnvironmentValues, fields: FieldSchemas): FormErrors {
  const errors: FormErrors = {};
  for (const [key, def] of Object.entries(fields)) {
    const value = environment[key];
    if (isEmpty(value)) {
      // The backend falls back to the default, so only a required field with no default is an error.
      if (def.required && def.default == null) errors[envPath(key)] = 'Required';
      continue;
    }
    if (def.type === 'integer' || def.type === 'number') {
      const num = Number(value);
      if (!Number.isFinite(num)) errors[envPath(key)] = 'Must be a number';
      else if (def.min !== undefined && num < def.min) errors[envPath(key)] = `Must be at least ${def.min}`;
      else if (def.max !== undefined && num > def.max) errors[envPath(key)] = `Must be at most ${def.max}`;
    }
  }
  return errors;
}

/** Turns a 422 `{fields: {...}}` response into form errors on `environment.*`. */
export function environmentErrors(fields: Record<string, string>): FormErrors {
  return Object.fromEntries(Object.entries(fields).map(([key, err]) => [envPath(key), err]));
}
