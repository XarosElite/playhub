import { beforeEach, describe, expect, it, vi } from 'vitest';

const system = vi.hoisted(() => ({ getSystemInfo: vi.fn(), getSystemIp: vi.fn() }));
vi.mock('../Api/System', () => ({ SystemApi: system }));

async function freshStore() {
  vi.resetModules();
  const module = await import('./SystemInfoStore');
  return module.systemInfoStore;
}

const sample = (cpu: number, time = '2026-11-01T13:05:09Z') => ({
  sys_info: { cpu_usage: cpu, total_ram_gb: 32, used_ram_gb: 8, used_ram_pct: 25, time },
});

beforeEach(() => {
  system.getSystemInfo.mockResolvedValue(sample(10));
  system.getSystemIp.mockResolvedValue({ ip: '203.0.113.7' });
});

describe('SystemInfoStore', () => {
  it('starts with a full window of zeroes so the charts have a baseline', async () => {
    const store = await freshStore();
    expect(store.systemHistory).toHaveLength(60);
    expect(store.systemHistory.every(p => p.sys_info.cpu_usage === 0)).toBe(true);
    expect(store.systemIP).toBe('Loading...');
  });

  it('appends new samples and drops the oldest', async () => {
    const store = await freshStore();
    for (let i = 1; i <= 3; i++) {
      system.getSystemInfo.mockResolvedValueOnce(sample(i * 10));
      await store.fetchSystemInfoPoint();
    }
    expect(store.systemHistory).toHaveLength(60);
    expect(store.systemHistory.slice(-3).map(p => p.sys_info.cpu_usage)).toEqual([10, 20, 30]);
    expect(store.latestSystemInfo.sys_info.cpu_usage).toBe(30);
  });

  it('formats sample times for the chart axis', async () => {
    const store = await freshStore();
    await store.fetchSystemInfoPoint();
    expect(store.latestSystemInfo.sys_info.time).toMatch(/^\d{1,2}:\d{2}:\d{2} (AM|PM)$/);
    expect(store.latestSystemInfo.sys_info).toMatchObject({ total_ram_gb: 32, used_ram_gb: 8, used_ram_pct: 25 });
  });

  it('fetches the public IP', async () => {
    const store = await freshStore();
    await store.fetchSystemIp();
    expect(store.systemIP).toBe('203.0.113.7');
  });
});
