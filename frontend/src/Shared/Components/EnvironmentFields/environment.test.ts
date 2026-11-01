import { describe, expect, it } from 'vitest';

import { allFields, envPath, environmentErrors, initialEnvironment, isEmpty, validateEnvironment, FieldSchemas } from './environment';
import { MINECRAFT, PALWORLD } from '../../../test/utils';

describe('allFields', () => {
  it('merges common and game-specific fields', () => {
    expect(Object.keys(allFields(MINECRAFT))).toEqual(['MAX_PLAYERS', 'EULA', 'MODE', 'SEED']);
  });

  it('is empty without a game', () => {
    expect(allFields(null)).toEqual({});
    expect(allFields(undefined)).toEqual({});
  });
});

describe('envPath', () => {
  it('nests under environment', () => {
    expect(envPath('MAX_PLAYERS')).toBe('environment.MAX_PLAYERS');
  });
});

describe('initialEnvironment', () => {
  it('uses schema defaults', () => {
    expect(initialEnvironment(allFields(MINECRAFT))).toEqual({ MAX_PLAYERS: 20, EULA: true, MODE: 'survival', SEED: '' });
  });

  it('booleans without a default start unchecked', () => {
    expect(initialEnvironment({ PVP: { type: 'boolean', label: 'PvP', required: false, default: null } })).toEqual({ PVP: false });
  });

  it('prefers saved values, including falsy ones', () => {
    const saved = { MAX_PLAYERS: 0, EULA: false, MODE: 'creative', SEED: '' };
    expect(initialEnvironment(allFields(MINECRAFT), saved)).toEqual(saved);
  });

  it('ignores saved values for fields no longer in the schema', () => {
    expect(initialEnvironment(allFields(MINECRAFT), { REMOVED: 'x' })).not.toHaveProperty('REMOVED');
  });
});

describe('isEmpty', () => {
  it.each([[undefined, true], ['', true], ['   ', true], ['x', false], [0, false], [false, false]])('%s → %s', (value, expected) => {
    expect(isEmpty(value as never)).toBe(expected);
  });
});

describe('validateEnvironment', () => {
  const fields = allFields(PALWORLD);
  const valid = { SERVER_PASSWORD: '', MAX_PLAYERS: 32, EXP_RATE: 1, ADMIN_TOKEN: 'secret' };

  it('accepts valid values', () => {
    expect(validateEnvironment(valid, fields)).toEqual({});
  });

  it('required fields without a default must be filled in', () => {
    expect(validateEnvironment({ ...valid, ADMIN_TOKEN: '  ' }, fields)).toEqual({ 'environment.ADMIN_TOKEN': 'Required' });
  });

  it('required fields with a default may be left empty (the backend uses the default)', () => {
    expect(validateEnvironment({ EULA: '' } as never, { EULA: MINECRAFT.fields.EULA })).toEqual({});
  });

  it('checks numeric bounds', () => {
    expect(validateEnvironment({ ...valid, MAX_PLAYERS: 0 }, fields)).toEqual({ 'environment.MAX_PLAYERS': 'Must be at least 1' });
    expect(validateEnvironment({ ...valid, MAX_PLAYERS: 101 }, fields)).toEqual({ 'environment.MAX_PLAYERS': 'Must be at most 100' });
    expect(validateEnvironment({ ...valid, MAX_PLAYERS: '50' }, fields)).toEqual({});
  });

  it('rejects non-numbers in numeric fields', () => {
    expect(validateEnvironment({ ...valid, EXP_RATE: 'fast' }, fields)).toEqual({ 'environment.EXP_RATE': 'Must be a number' });
  });

  it('empty optional numbers are fine', () => {
    expect(validateEnvironment({ ...valid, MAX_PLAYERS: '' }, fields)).toEqual({});
  });

  it('reports every problem at once', () => {
    const errors = validateEnvironment({ MAX_PLAYERS: 500, EXP_RATE: 'x', ADMIN_TOKEN: '' }, fields);
    expect(Object.keys(errors).sort()).toEqual(['environment.ADMIN_TOKEN', 'environment.EXP_RATE', 'environment.MAX_PLAYERS']);
  });

  it('only checks fields in the schema', () => {
    const schema: FieldSchemas = { A: { type: 'string', label: 'A', required: false, default: null } };
    expect(validateEnvironment({ A: 'x', EXTRA: 'y' }, schema)).toEqual({});
  });
});

describe('environmentErrors', () => {
  it('maps backend field errors onto form paths', () => {
    expect(environmentErrors({ MAX_PLAYERS: 'Must be at most 100', MODE: 'Must be one of: a, b' })).toEqual({
      'environment.MAX_PLAYERS': 'Must be at most 100',
      'environment.MODE': 'Must be one of: a, b',
    });
  });
});
