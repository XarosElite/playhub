import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StatusBadge from './StatusBadge';
import CopyAddress from './CopyAddress';
import RelativeTime from './RelativeTime';
import AnimatedNumber from './AnimatedNumber';
import { renderWithProviders } from '../../test/utils';
import { setReducedMotion } from '../../test/browser';
import { ServerState } from '../../Api/GameServer';
import { celebrateAt } from '../celebrate';
import { DURATION, EASE_OUT, fadeUp, page, prefersReducedMotion, stagger } from '../motion';

describe('StatusBadge', () => {
  it.each<[ServerState, string]>([
    ['running', 'Running'], ['starting', 'Starting'], ['restarting', 'Restarting'], ['updating', 'Updating'],
    ['stopping', 'Stopping'], ['exited', 'Stopped'], ['created', 'Stopped'], ['failed', 'Failed'],
  ])('%s reads "%s"', (state, label) => {
    renderWithProviders(<StatusBadge state={state} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('only in-progress states pulse', () => {
    const { rerender } = renderWithProviders(<StatusBadge state="starting" serverId="s1" />);
    expect(document.querySelector('[data-status-badge="s1"]')).toHaveClass('busy');
    rerender(<StatusBadge state="running" serverId="s1" />);
    expect(document.querySelector('[data-status-badge="s1"]')).not.toHaveClass('busy');
  });

  it('unknown states show the raw state', () => {
    renderWithProviders(<StatusBadge state={'paused' as ServerState} />);
    expect(screen.getByText('paused')).toBeInTheDocument();
  });

  it('explains failures on hover', async () => {
    renderWithProviders(<StatusBadge state="failed" message="Failed to start: port is already allocated" />);
    await userEvent.hover(screen.getByText('Failed'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Failed to start: port is already allocated');
  });

  it('compact mode is a labelled dot', async () => {
    renderWithProviders(<StatusBadge state="exited" message="Stopped unexpectedly (exit code 137)" compact serverId="s1" />);
    const dot = screen.getByLabelText('Stopped');
    expect(dot).toHaveAttribute('data-status-badge', 's1');
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
    await userEvent.hover(dot);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Stopped: Stopped unexpectedly (exit code 137)');
  });
});

describe('CopyAddress', () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  });

  it('copies the address and confirms', async () => {
    renderWithProviders(<CopyAddress address="203.0.113.7:10000" />);
    expect(screen.getByText('203.0.113.7:10000')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy 203.0.113.7:10000' }));
    expect(writeText).toHaveBeenCalledWith('203.0.113.7:10000');
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('button only', () => {
    renderWithProviders(<CopyAddress address="1.2.3.4:5" withText={false} />);
    expect(screen.queryByText('1.2.3.4:5')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy 1.2.3.4:5' })).toBeInTheDocument();
  });

  it('does not trigger the row click underneath', async () => {
    const onRowClick = vi.fn();
    renderWithProviders(<div onClick={onRowClick}><CopyAddress address="1.2.3.4:5" /></div>);
    await userEvent.click(screen.getByRole('button'));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('RelativeTime', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z'), shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('"… ago" with a prefix', () => {
    renderWithProviders(<RelativeTime date="2026-10-29T12:00:00Z" prefix="Created" />);
    expect(screen.getByText('Created 3 days ago')).toBeInTheDocument();
  });

  it('duration mode', () => {
    renderWithProviders(<RelativeTime date={new Date('2026-11-01T10:00:00Z')} mode="duration" />);
    expect(screen.getByText('2 hours')).toBeInTheDocument();
  });

  it('invalid dates', () => {
    renderWithProviders(<RelativeTime date="not a date" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('keeps itself up to date', () => {
    renderWithProviders(<RelativeTime date="2026-11-01T11:59:00Z" />);
    expect(screen.getByText('1 minute ago')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(60000); });
    expect(screen.getByText('2 minutes ago')).toBeInTheDocument();
  });
});

describe('AnimatedNumber', () => {
  it('shows the fallback without a value', () => {
    renderWithProviders(<div data-testid="n"><AnimatedNumber value={null} /></div>);
    expect(screen.getByTestId('n')).toHaveTextContent('—');
  });

  it('formats decimals and suffix', () => {
    renderWithProviders(<div data-testid="n"><AnimatedNumber value={12.345} decimals={1} suffix="%" /></div>);
    expect(screen.getByTestId('n')).toHaveTextContent('12.3%');
  });

  it('counts to new values', async () => {
    const { rerender } = renderWithProviders(<div data-testid="n"><AnimatedNumber value={1} /></div>);
    rerender(<div data-testid="n"><AnimatedNumber value={9} /></div>);
    await waitFor(() => expect(screen.getByTestId('n')).toHaveTextContent('9'), { timeout: 2000 });
  });

  it('jumps straight there with reduced motion', () => {
    setReducedMotion(true);
    const { rerender } = renderWithProviders(<div data-testid="n"><AnimatedNumber value={1} /></div>);
    rerender(<div data-testid="n"><AnimatedNumber value={9} /></div>);
    expect(screen.getByTestId('n')).toHaveTextContent('9');
  });

  it('back to the fallback when the value goes away', () => {
    const { rerender } = renderWithProviders(<div data-testid="n"><AnimatedNumber value={5} fallback="n/a" /></div>);
    rerender(<div data-testid="n"><AnimatedNumber value={undefined} fallback="n/a" /></div>);
    expect(screen.getByTestId('n')).toHaveTextContent('n/a');
  });
});

describe('celebrateAt', () => {
  const target = () => {
    const element = document.createElement('div');
    element.getBoundingClientRect = () => ({ left: 100, top: 50, width: 80, height: 20 } as DOMRect);
    document.body.appendChild(element);
    return element;
  };

  it('bursts confetti from the element, then cleans up', async () => {
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    HTMLElement.prototype.animate = vi.fn(() => ({ finished })) as unknown as typeof HTMLElement.prototype.animate;
    celebrateAt(target(), 10);
    const layer = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(layer).toBeInTheDocument();
    expect(layer.style.pointerEvents).toBe('none');
    expect(layer.children).toHaveLength(10);
    expect((layer.children[0] as HTMLElement).style.left).toBe('140px');
    finish();
    await waitFor(() => expect(layer).not.toBeInTheDocument());
  });

  it('skipped with reduced motion, for missing or hidden elements', () => {
    celebrateAt(null);
    const hidden = document.createElement('div');
    hidden.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 } as DOMRect);
    celebrateAt(hidden);
    setReducedMotion(true);
    celebrateAt(target());
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

describe('motion tokens', () => {
  it('keep UI feedback fast', () => {
    expect(DURATION.fast).toBeLessThan(DURATION.base);
    expect(DURATION.base).toBeLessThanOrEqual(0.25);
    expect(EASE_OUT).toHaveLength(4);
  });

  it('variants', () => {
    expect(fadeUp.hidden).toEqual({ opacity: 0, y: 8 });
    expect(stagger(0.1, 0.2).visible).toEqual({ transition: { staggerChildren: 0.1, delayChildren: 0.2 } });
    expect(Object.keys(page)).toEqual(['initial', 'animate', 'exit']);
  });

  it('reads the OS reduced-motion setting', () => {
    expect(prefersReducedMotion()).toBe(false);
    setReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});
