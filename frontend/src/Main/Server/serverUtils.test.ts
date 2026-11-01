import { describe, expect, it } from 'vitest';

import { DEFAULT_FILTERS, filterServers, formatMemory, isFiltered, serverAddress, serverPath, sortServers } from './serverUtils';
import { FRIEND, makeLive, makeServer } from '../../test/utils';
import { ServerState } from '../../Api/GameServer';

describe('serverAddress / serverPath', () => {
  it('joins the host IP and the server port', () => {
    expect(serverAddress(makeServer({ Ports: { primary_port: 10007 } }), '203.0.113.7')).toBe('203.0.113.7:10007');
  });

  it('routes by name, encoded', () => {
    expect(serverPath({ Name: 'mc1' })).toBe('/server/mc1');
    expect(serverPath({ Name: 'a b/c' })).toBe('/server/a%20b%2Fc');
  });
});

describe('isFiltered', () => {
  it('is false for the defaults', () => {
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltered({ ...DEFAULT_FILTERS, search: '   ' })).toBe(false);
  });

  it.each([
    { search: 'mc' },
    { scope: 'mine' as const },
    { games: ['palworld'] },
    { status: 'running' as const },
  ])('is true when %o is set', change => {
    expect(isFiltered({ ...DEFAULT_FILTERS, ...change })).toBe(true);
  });
});

describe('filterServers', () => {
  const mine = makeServer({ Name: 'survival-world', State: 'running', Ports: { primary_port: 10001 } });
  const stopped = makeServer({ Name: 'creative-build', State: 'exited' });
  const shared = makeServer({ Name: 'pals', GameType: 'palworld', State: 'starting', IsOwner: false, Owner: FRIEND, SharedWith: null });
  const broken = makeServer({ Name: 'broken', State: 'failed' });
  const all = [mine, stopped, shared, broken];

  it('returns everything by default', () => {
    expect(filterServers(all, DEFAULT_FILTERS)).toEqual(all);
  });

  it('scopes to mine or shared with me', () => {
    expect(filterServers(all, { ...DEFAULT_FILTERS, scope: 'mine' })).toEqual([mine, stopped, broken]);
    expect(filterServers(all, { ...DEFAULT_FILTERS, scope: 'shared' })).toEqual([shared]);
  });

  it('filters by game', () => {
    expect(filterServers(all, { ...DEFAULT_FILTERS, games: ['palworld'] })).toEqual([shared]);
    expect(filterServers(all, { ...DEFAULT_FILTERS, games: ['palworld', 'minecraft'] })).toEqual(all);
  });

  it.each<[string, ServerState[]]>([
    ['running', ['running']],
    ['stopped', ['exited', 'created']],
    ['busy', ['starting', 'stopping', 'restarting', 'updating']],
    ['failed', ['failed']],
  ])('groups statuses: %s', (status, states) => {
    const servers = (['running', 'exited', 'created', 'starting', 'stopping', 'restarting', 'updating', 'failed'] as ServerState[])
      .map(state => makeServer({ Name: state, State: state }));
    const result = filterServers(servers, { ...DEFAULT_FILTERS, status: status as never });
    expect(result.map(s => s.State)).toEqual(states);
  });

  it('searches name, game, owner and port, case-insensitively', () => {
    const search = (text: string) => filterServers(all, { ...DEFAULT_FILTERS, search: text }).map(s => s.Name);
    expect(search('SURVIVAL')).toEqual(['survival-world']);
    expect(search('palworld')).toEqual(['pals']);
    expect(search('sam')).toEqual(['pals']); // owner name
    expect(search('sam@example')).toEqual(['pals']); // owner email
    expect(search('10001')).toEqual(['survival-world']);
    expect(search('  creative  ')).toEqual(['creative-build']);
    expect(search('nothing-matches')).toEqual([]);
  });

  it('combines filters', () => {
    expect(filterServers(all, { search: 'world', scope: 'mine', games: ['minecraft'], status: 'running' })).toEqual([mine]);
    expect(filterServers(all, { search: 'survival', scope: 'shared', games: [], status: 'all' })).toEqual([]);
  });

  it('copes with owners without a name or email', () => {
    const ghost = makeServer({ Name: 'ghost', Owner: { uid: 'u', name: null, email: null, picture: null } });
    expect(filterServers([ghost], { ...DEFAULT_FILTERS, search: 'gho' })).toEqual([ghost]);
  });
});

describe('sortServers', () => {
  const a = makeServer({ Name: 'alpha', GameType: 'palworld', State: 'exited', Created: '2026-01-03T00:00:00Z', Live: null });
  const b = makeServer({ Name: 'Bravo', GameType: 'minecraft', State: 'running', Created: '2026-01-01T00:00:00Z',
    Live: makeLive({ cpu_pct: 50, players: { online: 1, max: 10, version: null } }) });
  const c = makeServer({ Name: 'charlie', GameType: 'minecraft', State: 'starting', Created: '2026-01-02T00:00:00Z',
    Live: makeLive({ cpu_pct: 5, players: { online: 7, max: 10, version: null } }) });
  const names = (servers: typeof a[]) => servers.map(s => s.Name);

  it('by name, ignoring case', () => {
    expect(names(sortServers([c, a, b], 'Name', 'asc'))).toEqual(['alpha', 'Bravo', 'charlie']);
    expect(names(sortServers([c, a, b], 'Name', 'desc'))).toEqual(['charlie', 'Bravo', 'alpha']);
  });

  it('by creation date', () => {
    expect(names(sortServers([a, b, c], 'Created', 'asc'))).toEqual(['Bravo', 'charlie', 'alpha']);
    expect(names(sortServers([a, b, c], 'Created', 'desc'))).toEqual(['alpha', 'charlie', 'Bravo']);
  });

  it('by status: running, then busy, then stopped', () => {
    expect(names(sortServers([a, c, b], 'State', 'asc'))).toEqual(['Bravo', 'charlie', 'alpha']);
  });

  it('by players and CPU, with stopped servers last', () => {
    expect(names(sortServers([a, b, c], 'Players', 'desc'))).toEqual(['charlie', 'Bravo', 'alpha']);
    expect(names(sortServers([a, b, c], 'Resources', 'desc'))).toEqual(['Bravo', 'charlie', 'alpha']);
  });

  it('ties break by name', () => {
    expect(names(sortServers([c, b], 'GameType', 'asc'))).toEqual(['Bravo', 'charlie']);
    expect(names(sortServers([c, b], 'GameType', 'desc'))).toEqual(['Bravo', 'charlie']);
  });

  it('unknown keys fall back to creation date', () => {
    expect(names(sortServers([a, b, c], 'Bogus' as never, 'asc'))).toEqual(['Bravo', 'charlie', 'alpha']);
  });

  it('does not modify the input', () => {
    const input = [c, a, b];
    sortServers(input, 'Name', 'asc');
    expect(input).toEqual([c, a, b]);
  });
});

describe('formatMemory', () => {
  it.each([
    [null, '—'], [undefined, '—'], [0, '0 MB'], [512.4, '512 MB'], [1023, '1023 MB'], [1024, '1.0 GB'], [1536, '1.5 GB'], [8192, '8.0 GB'],
  ])('%s → %s', (value, expected) => {
    expect(formatMemory(value)).toBe(expected);
  });
});
