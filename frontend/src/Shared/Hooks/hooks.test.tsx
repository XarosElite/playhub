import { useRef } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useExitingRecords } from './useExitingRecords';
import { useFlipRows } from './useFlipRows';
import { useNow } from './useNow';
import { setReducedMotion } from '../../test/browser';
import { DURATION } from '../motion';

type Row = { id: string };
const rows = (...ids: string[]): Row[] => ids.map(id => ({ id }));
const ids = (records: Array<Row & { __leaving?: boolean }>) => records.map(r => (r.__leaving ? `${r.id}*` : r.id));

describe('useExitingRecords', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (initial: Row[]) => renderHook(
    ({ visible, all }) => useExitingRecords<Row>(visible, all, r => r.id),
    { initialProps: { visible: initial, all: initial } },
  );

  it('passes records through unchanged', () => {
    const initial = rows('a', 'b');
    const { result } = setup(initial);
    expect(result.current).toBe(initial);
  });

  it('keeps a deleted record in place, flagged as leaving, then removes it', () => {
    const { result, rerender } = setup(rows('a', 'b', 'c'));
    const after = rows('a', 'c');
    rerender({ visible: after, all: after });
    expect(ids(result.current)).toEqual(['a', 'b*', 'c']);
    act(() => { vi.advanceTimersByTime(DURATION.slow * 1000 + 50); });
    expect(ids(result.current)).toEqual(['a', 'c']);
  });

  it('records filtered out (but not deleted) disappear immediately', () => {
    const all = rows('a', 'b', 'c');
    const { result, rerender } = setup(all);
    rerender({ visible: rows('a'), all });
    expect(ids(result.current)).toEqual(['a']);
  });

  it('new data mid-animation does not strand the ghost row', () => {
    const { result, rerender } = setup(rows('a', 'b'));
    rerender({ visible: rows('a'), all: rows('a') });
    act(() => { vi.advanceTimersByTime(100); });
    rerender({ visible: rows('a'), all: rows('a') }); // e.g. a live update
    expect(ids(result.current)).toEqual(['a', 'b*']);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(ids(result.current)).toEqual(['a']);
  });

  it('several deletions keep their original positions', () => {
    const { result, rerender } = setup(rows('a', 'b', 'c', 'd'));
    rerender({ visible: rows('b', 'd'), all: rows('b', 'd') });
    expect(ids(result.current)).toEqual(['a*', 'b', 'c*', 'd']);
  });

  it('with reduced motion, deletions are immediate', () => {
    setReducedMotion(true);
    const { result, rerender } = setup(rows('a', 'b'));
    rerender({ visible: rows('a'), all: rows('a') });
    expect(ids(result.current)).toEqual(['a']);
  });

  it('clears its timers on unmount', () => {
    const { rerender, unmount } = setup(rows('a', 'b'));
    rerender({ visible: rows('a'), all: rows('a') });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useNow', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('ticks at the given interval', () => {
    const { result } = renderHook(() => useNow(1000));
    const start = result.current;
    act(() => { vi.advanceTimersByTime(999); });
    expect(result.current).toBe(start);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(start + 1000);
  });

  it('defaults to every 30 seconds and stops on unmount', () => {
    const { result, unmount } = renderHook(() => useNow());
    const start = result.current;
    act(() => { vi.advanceTimersByTime(30000); });
    expect(result.current).toBe(start + 30000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useFlipRows', () => {
  let animate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    animate = vi.fn();
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
  });

  // jsdom has no layout, so rows report their position from data-top.
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) { return Number(this.dataset.top ?? 0); },
  });

  const Table = ({ order }: { order: string[] }) => {
    const ref = useRef<HTMLTableElement>(null);
    useFlipRows(ref, order);
    return (
      <table ref={ref}>
        <tbody>
          {order.map((id, index) => <tr key={id} data-row-id={id} data-top={index * 40}><td>{id}</td></tr>)}
        </tbody>
      </table>
    );
  };

  it('does not animate the first render', () => {
    render(<Table order={['a', 'b']} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('rows that move glide from their old position', () => {
    const { rerender } = render(<Table order={['a', 'b', 'c']} />);
    rerender(<Table order={['c', 'a', 'b']} />);
    const moves = animate.mock.calls.map(([frames]) => frames[0].transform);
    expect(moves).toEqual(['translateY(80px)', 'translateY(-40px)', 'translateY(-40px)']);
  });

  it('new rows fade in, unmoved rows stay still', () => {
    const { rerender } = render(<Table order={['a']} />);
    rerender(<Table order={['a', 'b']} />);
    expect(animate).toHaveBeenCalledOnce();
    expect(animate.mock.calls[0][0]).toEqual([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }]);
  });

  it('nothing animates with reduced motion', () => {
    setReducedMotion(true);
    const { rerender } = render(<Table order={['a', 'b']} />);
    rerender(<Table order={['b', 'a', 'c']} />);
    expect(animate).not.toHaveBeenCalled();
  });
});
