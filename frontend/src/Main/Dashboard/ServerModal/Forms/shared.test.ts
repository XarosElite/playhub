import { describe, expect, it } from 'vitest';

import { validateServerName } from './shared';

// The backend applies the same rules (api/app/depenencies.py validate_server_name).
describe('validateServerName', () => {
  it.each(['abc', 'mc1', 'My-Server_2.0', 'a.b.c', 'A1b', 'x'.repeat(36), '123'])('accepts %s', name => {
    expect(validateServerName(name)).toBeNull();
  });

  it.each([
    ['', 'Must be between 3 and 36 characters'],
    ['ab', 'Must be between 3 and 36 characters'],
    ['x'.repeat(37), 'Must be between 3 and 36 characters'],
    ['.mc', 'Cannot start or end with ".", "_", or "-"'],
    ['mc_', 'Cannot start or end with ".", "_", or "-"'],
    ['-mc-', 'Cannot start or end with ".", "_", or "-"'],
    ['a--b', 'Cannot contain sequential symbols like "..", "__", or "--"'],
    ['a._b', 'Cannot contain sequential symbols like "..", "__", or "--"'],
    ['a b', 'Can only contain letters, numbers, ".", "_", or "-"'],
    ['a/b', 'Can only contain letters, numbers, ".", "_", or "-"'],
    ['ünï', 'Can only contain letters, numbers, ".", "_", or "-"'],
    ['mc1;rm', 'Can only contain letters, numbers, ".", "_", or "-"'],
  ])('rejects %j', (name, error) => {
    expect(validateServerName(name)).toBe(error);
  });
});
